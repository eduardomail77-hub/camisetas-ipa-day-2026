# Camisetas IPA Day 2026, Metal Edition

Site de venda da camiseta oficial do IPA Day 2026 (R$ 64,90, tamanhos PP a Nobre).
Mesma arquitetura dos projetos Namorados/Latas: Vercel + Google Sheets, trocando o
gateway de pagamento para **InfinitePay** (nos outros projetos era Mercado Pago).

## Como funciona

1. Cliente preenche nome, WhatsApp, e escolhe quantidade por tamanho (pode levar
   mais de um tamanho na mesma compra, ex: 1 G + 2 GG).
2. Clica em comprar, o site grava um pedido "AGUARDANDO PAGAMENTO" na planilha e
   cria um link de pagamento na InfinitePay, redirecionando o cliente pra lá.
3. A InfinitePay só chama o webhook quando o pagamento já foi APROVADO (não existe
   um pagamento "recusado" chamando o webhook), então a própria chamada já é a
   confirmação. O webhook encontra a linha pelo Order NSU e marca "PAGO ✅", além de
   avisar no WhatsApp.
4. Retirada é só no dia do evento (15/08), na Fora da Lei Pub. Sem entrega, sem
   controle de estoque por tamanho.

## Estrutura

```
camisetas-ipa-day-2026/
├── index.html                    página de venda (formulário + checkout)
├── sucesso.html                  confirmação pós-pagamento
├── logo.png                      logo Fora da Lei (copiar de outro projeto)
├── camiseta-hero.jpg             foto do casal usando a camiseta (a que você mandou)
├── package.json
└── api/
    ├── criar-pagamento.js        grava pedido pendente no Sheets e cria o link InfinitePay
    └── webhook-infinitepay.js    confirma pagamento, atualiza o Sheets, avisa no WhatsApp
```

## Passo a passo pra publicar (Vercel)

1. Suba esta pasta para um repositório no GitHub (ou reaproveite a conta Vercel dos
   outros projetos).
2. Na Vercel: New Project, importe o repositório.
3. Em Settings, Environment Variables, configure:

```
INFINITEPAY_HANDLE=fdl-producoes     (confirmado, sem o $)
GOOGLE_SERVICE_ACCOUNT={...}         (JSON da Service Account, pode reusar a dos outros projetos)
GOOGLE_SHEET_ID=...                  (ID de uma planilha NOVA, só pra camisetas)
SITE_URL=https://camisetas.foradalei.com.br
```

Não precisa de API key, a InfinitePay autentica só pelo `handle` no corpo da
requisição (confirmado na documentação oficial deles).

4. Crie uma planilha Google nova com a aba "Página1" e cabeçalho:
   `Data | Nome | WhatsApp | Tamanho | Quantidade | Valor | Status | Order NSU | Retirado?`
   Cada pedido gera uma linha POR TAMANHO (não uma linha por pedido), todas
   compartilhando o mesmo Order NSU, pra dar pra fazer tabela dinâmica por
   tamanho depois.
5. Compartilhe a planilha com o e-mail da Service Account (permissão de Editor).
6. Configure o domínio `camisetas.foradalei.com.br` apontando pra esse projeto na
   Vercel (Settings > Domains).
7. Deploy. Faça uma compra de teste (Pix R$ 0,01 ou o menor valor que a InfinitePay
   permitir, se tiver ambiente de teste) e confira:
   - a linha "AGUARDANDO PAGAMENTO" apareceu na planilha assim que clicou em comprar;
   - depois de pagar, ela virou "PAGO ✅";
   - o aviso chegou no WhatsApp.

## Referência da API (confirmado na documentação interativa da InfinitePay)

- Criar link: `POST https://api.checkout.infinitepay.io/links`, corpo com `handle`,
  `items` (quantity, price em centavos, description), `order_nsu`, `redirect_url`,
  `webhook_url`, `customer` (opcional).
- Webhook (`POST` na sua `webhook_url`), disparado só quando o pagamento é aprovado:
  `order_nsu`, `transaction_nsu`, `invoice_slug`, `amount`, `paid_amount`,
  `capture_method`, `receipt_url`, `items`. Responder rápido com `200 OK`; se
  responder `400`, a InfinitePay tenta reenviar (é o que o código faz se der erro
  ao gravar no Sheets, pra não perder a confirmação).
- Consulta manual (se precisar): `POST https://api.checkout.infinitepay.io/payment_check`
  com `handle`, `order_nsu`, `transaction_nsu`, `slug`.

## Observações

- O Pixel da Meta (2032280697195908) e o GA4 (G-B92W6B9BLJ) já estão no HTML, mesmos
  usados nos outros sites da Fora da Lei.
- WhatsApp de aviso (CallMeBot): mesmo número/apikey dos outros projetos, ajuste em
  `api/webhook-infinitepay.js` se quiser trocar.
- Sem controle de estoque por tamanho, como combinado. Se decidir limitar depois, dá
  pra adicionar igual foi feito no site das latas.
- Preço único de R$ 64,90 para todos os tamanhos, sem variação por lote/desconto.
