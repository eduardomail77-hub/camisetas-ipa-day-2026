const { google } = require('googleapis');
const https = require('https');

async function enviarWhatsApp(resumo, transactionId) {
  try {
    const msg = `👕 Nova camiseta PAGA!\n👤 ${resumo.nome}\n📏 Tamanhos: ${resumo.tamanhosTexto}\n🔢 Qtd total: ${resumo.quantidadeTotal}\n💰 R$ ${resumo.valorTotal.toFixed(2).replace('.', ',')}\n📱 WhatsApp: ${resumo.whatsapp}\n🆔 ${transactionId || '-'}`;
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

// Acha TODAS as linhas do Order NSU (coluna H, pode ser mais de uma, uma por
// tamanho) e marca cada uma como PAGO (coluna G), devolvendo um resumo
// agregado pra usar no aviso de WhatsApp.
async function confirmarPagamento(orderNsu, transactionId) {
  const sheets = await sheetsClient();
  const range = 'Página1!A:I';
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range });
  const rows = r.data.values || [];

  const linhasDoPedido = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][7] === orderNsu) linhasDoPedido.push({ numero: i + 1, dados: rows[i] }); // planilha é 1-indexed
  }
  if (linhasDoPedido.length === 0) return null;

  // já processado, evita reenviar aviso em webhook duplicado
  const pendentes = linhasDoPedido.filter((l) => l.dados[6] !== 'PAGO ✅');
  if (pendentes.length === 0) return null;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: pendentes.map((l) => ({ range: `Página1!G${l.numero}`, values: [['PAGO ✅']] })),
    },
  });

  const primeira = linhasDoPedido[0].dados;
  const quantidadeTotal = linhasDoPedido.reduce((soma, l) => soma + (parseInt(l.dados[4], 10) || 0), 0);
  const valorTotal = linhasDoPedido.reduce((soma, l) => {
    const v = parseFloat(String(l.dados[5]).replace('R$', '').replace('.', '').replace(',', '.').trim());
    return soma + (isNaN(v) ? 0 : v);
  }, 0);
  const tamanhosTexto = linhasDoPedido.map((l) => `${l.dados[3]} x${l.dados[4]}`).join(', ');

  return {
    nome: primeira[1],
    whatsapp: primeira[2],
    tamanhosTexto,
    quantidadeTotal,
    valorTotal,
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
