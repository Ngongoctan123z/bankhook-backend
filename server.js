import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Mảng lưu tạm các giao dịch (sẽ mất khi tắt server)
const transactions = [];

app.get('/health', (req, res) => {
  res.json({ status: "ok" });
});

// Trang giao diện Web để bạn xem lịch sử
app.get('/', (req, res) => {
  let html = `
    <html>
      <head>
        <title>Lịch sử giao dịch</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; background-color: #f8f9fa; }
          .container { max-width: 900px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #dee2e6; padding: 12px; text-align: left; }
          th { background-color: #e9ecef; }
          .credit { color: #28a745; font-weight: bold; }
          .debit { color: #dc3545; font-weight: bold; }
          .empty { text-align: center; color: #6c757d; padding: 20px; }
        </style>
        <meta http-equiv="refresh" content="5"> <!-- Tự động làm mới trang mỗi 5 giây -->
      </head>
      <body>
        <div class="container">
          <h2>📊 Biến động số dư (Bank Webhook)</h2>
          <p>Trang này sẽ tự động làm mới để cập nhật giao dịch mới nhất.</p>
          <table>
            <tr>
              <th>Thời gian</th>
              <th>Ngân hàng</th>
              <th>Loại</th>
              <th>Số tiền</th>
              <th>Nội dung</th>
              <th>Mã GD</th>
            </tr>
  `;

  if (transactions.length === 0) {
    html += `<tr><td colspan="6" class="empty">Chưa có giao dịch nào. Hãy dùng Postman gửi test!</td></tr>`;
  } else {
    transactions.forEach(tx => {
      const typeClass = tx.direction === 'CREDIT' ? 'credit' : 'debit';
      const typeText = tx.direction === 'CREDIT' ? '+ NHẬN' : '- TRỪ';
      const amount = tx.amount ? tx.amount.toLocaleString('vi-VN') : 0;
      
      html += `
        <tr>
          <td>${tx.time}</td>
          <td><b>${tx.bank || ''}</b></td>
          <td class="${typeClass}">${typeText}</td>
          <td class="${typeClass}">${amount} ${tx.currency || 'VND'}</td>
          <td>${tx.content || ''}</td>
          <td>${tx.transactionReference || ''}</td>
        </tr>
      `;
    });
  }

  html += `
          </table>
        </div>
      </body>
    </html>
  `;
  res.send(html);
});

const GROQ_MODELS = [
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "llama-3.1-8b-instant",
  "llama3-8b-8192",
  "llama3-70b-8192",
  "mixtral-8x7b-32768",
  "gemma2-9b-it"
];

async function parseWithGroq(notification) {
  const prompt = `
Chỉ trả về một đối tượng JSON hợp lệ, không dùng markdown code blocks, không giải thích.
Cấu trúc JSON yêu cầu:
{
  "bank": "MB|BIDV|UNKNOWN",
  "direction": "CREDIT|DEBIT|UNKNOWN",
  "amount": number|null,
  "currency": "VND",
  "content": string|null,
  "transactionReference": string|null,
  "confidence": number
}

Notification:
Package: ${notification.packageName}
Title: ${notification.title}
Text: ${notification.text}
BigText: ${notification.bigText || ''}
`;

  const attemptedModels = [];
  let lastError = null;

  for (const model of GROQ_MODELS) {
    attemptedModels.push(model);
    try {
      const chatCompletion = await groq.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: model,
      });

      const text = chatCompletion.choices[0]?.message?.content || "";
      const cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();

      let parsedData;
      try {
        parsedData = JSON.parse(cleanText);
      } catch (e) {
        throw new Error(`JSON Parse Error: ${e.message}`);
      }

      const requiredFields = ["bank", "direction", "amount", "currency", "content", "transactionReference", "confidence"];
      const missingFields = requiredFields.filter(field => parsedData[field] === undefined);

      if (missingFields.length > 0) {
        throw new Error(`Thiếu field trong JSON: ${missingFields.join(", ")}`);
      }

      console.log(`✅ Model thành công: ${model}`);
      return { parsedData, model };
    } catch (error) {
      // Bỏ qua lỗi và thử model tiếp theo
      lastError = error.message || String(error);
    }
  }

  throw { 
    error: "No configured Groq model succeeded", 
    attemptedModels, 
    details: lastError 
  };
}

app.post('/api/receive', async (req, res) => {
  try {
    const notification = req.body;
    console.log('Received:', notification.packageName, notification.title);
    
    const result = await parseWithGroq(notification);
    
    const { parsedData, model } = result;

    // Lưu vào mảng để hiển thị lên giao diện Web
    transactions.unshift({
      time: new Date().toLocaleString('vi-VN'),
      ...parsedData
    });
    
    res.json({ status: 'ok', parsed: parsedData, model });
  } catch (err) {
    if (err.attemptedModels) {
      // Nghĩa là fail toàn bộ list
      console.error('All models failed:', err.details);
      return res.status(502).json(err);
    }
    
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
