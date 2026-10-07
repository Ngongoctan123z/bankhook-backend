

async function runTest() {
  const payload = {
    packageName: "com.mbmobile",
    title: "MB Bank",
    text: "Thông báo biến động số dư: TK 05xxx172|GD: +10,000VND 07/10/26 21:35|SD: 150,000VND|TU: NGO NGOC TAN - 2820052025|ND: vndocs 123 FT26281259614610 k2PPNHDA/638453",
    bigText: ""
  };

  console.log("Sending payload:", payload);

  const res = await fetch('http://localhost:3000/api/receive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  console.log("Response:", JSON.stringify(data, null, 2));

  if (data.parsed) {
    const { content, transactionId, referenceCode } = data.parsed;
    if (content === "vndocs 123" && transactionId === "FT26281259614610" && referenceCode === "k2PPNHDA/638453") {
      console.log("✅ Regression Test PASSED!");
    } else {
      console.error("❌ Regression Test FAILED! Parsed output does not match expectations.");
    }
  } else {
    console.error("❌ Regression Test FAILED! No parsed data returned.");
  }
}

runTest();
