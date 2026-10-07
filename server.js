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
      const isCredit = tx.direction === 'CREDIT' || tx.direction === 'IN';
      const typeClass = isCredit ? 'credit' : 'debit';
      const typeText = isCredit ? '+ NHẬN' : '- TRỪ';
      const amount = tx.amount ? tx.amount.toLocaleString('vi-VN') : 0;
      
      html += `
        <tr>
          <td>${tx.time}</td>
          <td><b>${tx.bank || ''}</b></td>
          <td class="${typeClass}">${typeText}</td>
          <td class="${typeClass}">${amount} ${tx.currency || 'VND'}</td>
          <td>${tx.content || ''}</td>
          <td>${tx.transactionId || tx.transactionReference || ''}</td>
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
  "direction": "IN|OUT|UNKNOWN",
  "amount": number|null,
  "currency": "VND",
  "content": string|null,
  "transactionId": string|null,
  "referenceCode": string|null,
  "confidence": number
}

Quy tắc:
- MỤC TIÊU TỐI THƯỢNG: Chỉ trích xuất ĐÚNG và DUY NHẤT nội dung người dùng thực sự nhập vào khi chuyển khoản (VD: mã VNDOCS, tên gói, email, lời nhắn).
- BẮT BUỘC LỌC BỎ 100% SỐ RÁC: Xóa sạch mọi dãy số nhăng cuội do ngân hàng tự chèn vào (như số tài khoản, số dư, số tiền, ngày giờ, số thẻ, số máy POS).
- Content kết thúc NGAY TRƯỚC token mã kỹ thuật đầu tiên.
- transactionId là token kỹ thuật đầu tiên sau content, ưu tiên mã bắt đầu bằng chữ và có chữ + số, ví dụ \`FT26281259614610\`.
- referenceCode là token kỹ thuật tiếp theo có dấu \`/\`.
- TUYỆT ĐỐI Không bao giờ đưa transactionId / referenceCode / số tiền / số dư / tài khoản / thời gian vào trường \`content\`.
- Nếu không đủ chắc chắn, trả null thay vì đoán.

Examples:
Example 1:
Input: ...|ND: vndocs 123 FT26281259614610 k2PPNHDA/638453
Output: {"content":"vndocs 123","transactionId":"FT26281259614610","referenceCode":"k2PPNHDA/638453"}

Example 2:
Input: ...|ND: thanh toan don hang 102 FT987654321 ABCD/999
Output: {"content":"thanh toan don hang 102","transactionId":"FT987654321","referenceCode":"ABCD/999"}

Example 3:
Input: ...|ND: TRA NO FT111222333 XYZ/456
Output: {"content":"TRA NO","transactionId":"FT111222333","referenceCode":"XYZ/456"}

Example 4:
Input: ...|ND: vndocs-plus-ngongoctan282005@gmail.com FT123456
Output: {"content":"vndocs-plus-ngongoctan282005@gmail.com","transactionId":"FT123456","referenceCode":null}

Example 5:
Input: ...|ND: vndocs-pro-abc@example.com k2PPNHDA/638453
Output: {"content":"vndocs-pro-abc@example.com","transactionId":null,"referenceCode":"k2PPNHDA/638453"}

Example 6:
Input: ...|GD: +150,000VND|SD: 500,000VND|ND: 12345678 vndocs-plus-abc@gmail.com 0987654321 FT12345
Output: {"content":"vndocs-plus-abc@gmail.com","transactionId":"FT12345","referenceCode":null}

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

      const requiredFields = ["bank", "direction", "amount", "currency", "content", "transactionId", "referenceCode", "confidence"];
      const missingFields = requiredFields.filter(field => parsedData[field] === undefined);

      if (missingFields.length > 0) {
        throw new Error(`Thiếu field trong JSON: ${missingFields.join(", ")}`);
      }

      // Validation & Post-processing
      if (parsedData.content) {
         let contentTokens = parsedData.content.split(' ');
         contentTokens = contentTokens.filter(token => !/^FT[A-Z0-9]+$/i.test(token) && !token.includes('/'));
         parsedData.content = contentTokens.join(' ').trim();
      }
      if (parsedData.transactionId) {
         if (!/[A-Za-z]/.test(parsedData.transactionId) || !/[0-9]/.test(parsedData.transactionId)) {
            parsedData.transactionId = null;
         }
      }
      if (parsedData.referenceCode) {
         if (!parsedData.referenceCode.includes('/')) {
            parsedData.referenceCode = null;
         }
      }

      // Extract Payment Code (VNDOCS)
      let paymentCode = null;
      const rawText = notification.text || "";
      const tokens = rawText.split(/\s+/);
      let vndocsIndex = -1;
      
      for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].toLowerCase().includes('vndocs')) {
          if (tokens[i].toLowerCase() !== 'vndocs') {
             paymentCode = tokens[i].toLowerCase().trim();
             break;
          }
          vndocsIndex = i;
          break;
        }
      }
      
      if (!paymentCode && vndocsIndex !== -1) {
        let firstValidToken = null;
        let emailToken = null;
        for (let i = vndocsIndex + 1; i < tokens.length; i++) {
          const token = tokens[i];
          if (/^FT[A-Z0-9]+$/i.test(token)) continue;
          if (token.includes('/')) continue;
          
          const cleanNum = token.replace(/[^\d]/g, '');
          if (parsedData.amount && cleanNum === String(parsedData.amount)) continue;
          
          if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(token)) {
            emailToken = token;
            break;
          }
          if (!firstValidToken) {
            firstValidToken = token;
          }
        }
        if (emailToken) {
          paymentCode = emailToken.toLowerCase().trim();
        } else if (firstValidToken) {
          paymentCode = firstValidToken.toLowerCase().trim();
        }
      }

      parsedData.paymentCode = paymentCode;
      parsedData.contentRaw = rawText; // For internal debugging

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


app.get('/api/transactions', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (process.env.BANKHOOK_API_KEY && apiKey !== process.env.BANKHOOK_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const limit = parseInt(req.query.limit) || 50;
  const maxLimit = Math.min(limit, 100);
  
  const formattedTransactions = transactions.slice(0, maxLimit).map(tx => ({
    receivedAt: tx.receivedAt || new Date().toISOString(),
    bank: tx.bank,
    direction: tx.direction,
    amount: tx.amount,
    currency: tx.currency || 'VND',
    content: tx.content || null,
    transactionId: tx.transactionId || null,
    referenceCode: tx.referenceCode || null
  }));

  res.json({
    transactions: formattedTransactions,
    note: "Data is currently stored in RAM and will be lost on server restart."
  });
});

app.post('/api/receive', async (req, res) => {
  try {
    const notification = req.body;
    // Đã xoá log raw notification thô để bảo mật
    
    const result = await parseWithGroq(notification);
    
    const { parsedData, model } = result;

    // Lưu vào mảng để hiển thị lên giao diện Web (giấu contentRaw)
    const displayData = { ...parsedData };
    delete displayData.contentRaw; // Không hiển thị raw notification

    transactions.unshift({
      time: new Date().toLocaleString('vi-VN'),
      receivedAt: new Date().toISOString(),
      ...displayData
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
