

async function runTest() {
  const testCases = [
    {
      name: "Case 1: Normal with email",
      text: "Thông báo: TK 05xxx172|GD: +10,000VND|ND: 56890 VNDOCS ngongoctan282005 email abc@example.com 2356899 FT26281359498067 k2PPNHDA/638453",
      expectedPaymentCode: "abc@example.com"
    },
    {
      name: "Case 2: Normal string token",
      text: "VNDOCS ngongoctan282005 FT123456 ABC/789",
      expectedPaymentCode: "ngongoctan282005"
    },
    {
      name: "Case 3: Direct email token",
      text: "VNDOCS abc@example.com FT123456",
      expectedPaymentCode: "abc@example.com"
    },
    {
      name: "Case 4: No VNDOCS",
      text: "Thanh toan tien nha ngongoctan282005 FT123456",
      expectedPaymentCode: null
    },
    {
      name: "Case 5: Amount mixed after VNDOCS",
      text: "GD: +50,000VND|ND: VNDOCS 50000 ngongoctan282005 FT123",
      expectedPaymentCode: "ngongoctan282005"
    }
  ];

  let passed = 0;
  for (const tc of testCases) {
    const payload = {
      packageName: "com.mbmobile",
      title: "MB Bank",
      text: tc.text,
      bigText: ""
    };

    const res = await fetch('http://localhost:3005/api/receive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const textRes = await res.text();
    let data;
    try {
      data = JSON.parse(textRes);
    } catch (e) {
      console.error(`❌ ${tc.name} FAILED! Server returned non-JSON: ${res.status} ${res.statusText}`);
      console.error(textRes);
      continue;
    }

    if (data.parsed && data.parsed.paymentCode === tc.expectedPaymentCode) {
      console.log(`✅ ${tc.name} PASSED (paymentCode: ${tc.expectedPaymentCode})`);
      passed++;
    } else {
      console.error(`❌ ${tc.name} FAILED! Expected: ${tc.expectedPaymentCode}, Got: ${data.parsed?.paymentCode}`);
      console.error(data.parsed);
    }
  }

  console.log(`\nResults: ${passed}/${testCases.length} Passed`);
}

runTest();
