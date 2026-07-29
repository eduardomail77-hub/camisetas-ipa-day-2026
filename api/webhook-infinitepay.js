const { google } = require('googleapis');
const https = require('https');

async function enviarWhatsApp(linha, transactionId) {
  try {
    const msg = `👕 Nova camiseta PAGA!\n👤 ${linha.nome}\n📏 Tamanhos: ${linha.tamanhos}\n🔢 Qtd total: ${linha.quantidade}\n💰 ${linha.valor}\n📱 WhatsApp: ${linha.whatsapp}\n🆔 ${transactionId || '-'}`;
    const encoded = encodeURIComponent(msg);
    // Troque os números/apikeys do CallMeBot conforme seu cadastro
    const url = `https://api.callmebot.com/whatsapp.php?phone=555180144565&text=${encoded}&apikey=1059558`;
    await new Promise((resolve) => {
      const r = https.get(url, (resp) => { resp.resume(); resolve(); });
      r.on('error', resolve);
      r.setTimeout(5000, () => { r.destroy(); resolve(); });
    });
  } catch (err) {
    console.error('Erro WhatsApp:', err.message);
  }
}

async function sheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// Acha a linha pelo Order NSU (coluna H) e marca como PAGO (coluna G),
// devolvendo os dados da linha pra usar no aviso de WhatsApp.
async function confirmarPagamento(orderNsu, transactionId) {
  const sheets = await sheetsClient();
  const range = 'Página1!A:I';
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range });
  const rows = r.data.values || [];

  let rowIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][7] === orderNsu) { rowIndex = i; break; } // H = index 7
  }
  if (rowIndex === -1) return null;

  const linhaAtual = rows[rowIndex];
  // já processado, evita reenviar aviso em webhook duplicado
  if (linhaAtual[6] === 'PAGO ✅') return null;

  const linhaNumero = rowIndex + 1; // planilha é 1-indexed
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `Página1!G${linhaNumero}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['PAGO ✅']] },
  });

  return {
    nome: linhaAtual[1],
    whatsapp: linhaAtual[2],
    tamanhos: linhaAtual[3],
    quantidade: linhaAtual[4],
    valor: linhaAtual[5],
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(200).send('OK');

  try {
    console.log('Webhook InfinitePay recebido:', JSON.stringify(req.body));

    // A InfinitePay só chama esse webhook quando o pagamento JÁ foi aprovado,
    // não existe campo de "status" pra checar, a própria chamada é a confirmação.
    const body = req.body || {};
    const orderNsu = body.order_nsu;
    const transactionNsu = body.transaction_nsu || '';

    if (!orderNsu) {
      // corpo sem order_nsu não é um webhook válido de pagamento, não é erro nosso
      return res.status(200).send('OK');
    }

    const linha = await confirmarPagamento(orderNsu, transactionNsu);
    if (linha) await enviarWhatsApp(linha, transactionNsu);

    return res.status(200).send('OK');
  } catch (err) {
    console.error('Erro webhook InfinitePay:', err);
    // 400 faz a InfinitePay tentar reenviar o webhook depois, útil se foi
    // problema temporário nosso (Sheets fora do ar, etc), conforme a doc deles.
    return res.status(400).send('Erro ao processar webhook');
  }
};
