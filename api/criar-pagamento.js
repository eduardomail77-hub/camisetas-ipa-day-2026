const { google } = require('googleapis');

const PRECO = 1.00; // TEMP: valor de teste, voltar pra 64.90 depois

function gerarOrderNsu() {
  return `IPADAYCAM-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function registrarPendente(orderNsu, d) {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: 'Página1!A:I',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        new Date().toLocaleString('pt-BR'), // A Data
        d.nome,                              // B Nome
        d.whatsapp,                          // C WhatsApp
        d.itensTexto,                        // D Tamanhos (ex: "G x2, GG x1")
        d.quantidadeTotal,                   // E Quantidade total
        `R$ ${d.valorTotal.toFixed(2).replace('.', ',')}`, // F Valor
        'AGUARDANDO PAGAMENTO',              // G Status
        orderNsu,                            // H Order NSU
        '',                                  // I Retirado?
      ]],
    },
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  try {
    const d = req.body;

    if (!d.nome || !d.whatsapp) {
      return res.status(400).json({ error: 'Nome e WhatsApp são obrigatórios.' });
    }
    const tamanhosValidos = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'XXG', 'Nobre'];
    const itensBrutos = Array.isArray(d.itens) ? d.itens : [];
    const itens = itensBrutos
      .map((it) => ({
        tamanho: it.tamanho,
        quantidade: Math.max(0, Math.min(10, parseInt(it.quantidade, 10) || 0)),
      }))
      .filter((it) => tamanhosValidos.includes(it.tamanho) && it.quantidade > 0);

    if (itens.length === 0) {
      return res.status(400).json({ error: 'Escolha ao menos 1 camiseta, em algum tamanho.' });
    }

    const quantidadeTotal = itens.reduce((soma, it) => soma + it.quantidade, 0);
    const valorTotal = quantidadeTotal * PRECO;
    const itensTexto = itens.map((it) => `${it.tamanho} x${it.quantidade}`).join(', ');

    const orderNsu = gerarOrderNsu();

    // Grava a linha como "aguardando pagamento" ANTES de ir pro checkout,
    // o webhook depois só atualiza o status quando o pagamento confirmar.
    try {
      await registrarPendente(orderNsu, { nome: d.nome, whatsapp: d.whatsapp, itensTexto, quantidadeTotal, valorTotal });
    } catch (e) {
      console.error('Falha ao gravar pendente no Sheets:', e.message);
    }

    const handle = (process.env.INFINITEPAY_HANDLE || '').replace(/^\$/, '');

    const body = {
      handle,
      order_nsu: orderNsu,
      redirect_url: `${process.env.SITE_URL}/sucesso.html`,
      webhook_url: `${process.env.SITE_URL}/api/webhook-infinitepay`,
      customer: {
        name: d.nome,
        phone_number: d.whatsapp,
      },
      items: itens.map((it) => ({
        quantity: it.quantidade,
        price: Math.round(PRECO * 100), // em centavos
        description: `Camiseta Oficial IPA Day 2026, Metal Edition, tamanho ${it.tamanho}`,
      })),
    };

    // Autenticação é só pelo "handle" no corpo, a InfinitePay não usa API key aqui.
    const resp = await fetch('https://api.checkout.infinitepay.io/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await resp.json();
    if (!resp.ok || !data.url) {
      console.error('Erro InfinitePay:', resp.status, data);
      return res.status(502).json({ error: 'Erro ao criar o pagamento. Tente novamente.' });
    }

    return res.status(200).json({ url: data.url });

  } catch (err) {
    console.error('Erro ao criar pagamento:', err);
    return res.status(500).json({ error: 'Erro interno ao criar pagamento.' });
  }
};
