# Casa dos Botões — Loja Estática

E-commerce de botões e aviamentos, 100% estático, hospedado no GitHub Pages.

**Site ao vivo:** https://casadosbotoes.github.io/loja/

---

## ✨ Recursos

- **Catálogo de produtos** com fotos, categorias, busca e filtros
- **Carrinho persistente** (localStorage, não some ao fechar navegador)
- **Checkout em 3 etapas**: dados + frete → pagamento → confirmação
- **Pix QR Code** gerado no próprio navegador (sem taxa, sem intermediário)
- **Mercado Pago** (opcional): cartão de crédito até 12x e Pix dinâmico via Worker
- **Cálculo de frete** via API oficial dos Correios (PAC + SEDEX)
- **Frete grátis** acima de R$ 199 (configurável)
- **WhatsApp**: integração de atendimento e confirmação de pedidos
- **Design responsivo** (mobile, tablet, desktop)
- **Identidade visual** vinho + creme + tons de madeira

## 🛠️ Stack

- HTML5, CSS3, JavaScript Vanilla (sem framework, sem build)
- `qrcode-generator` (via CDN) para gerar QR Codes
- API oficial dos Correios (`api.correios.com.br`)
- API do Mercado Pago (via Worker opcional)
- GitHub Pages para hospedagem
- GitHub Actions para deploy automático

## 📁 Estrutura

```
loja/
├── index.html              # Página principal
├── config.js               # ← EDITE AQUI suas configurações
├── products.js             # ← EDITE AQUI seus produtos
├── css/style.css           # Estilos (vinho/creme/madeira)
├── js/
│   ├── pix.js              # Gerador de BR Code Pix (EMV)
│   ├── cart.js             # Carrinho + drawer
│   ├── shipping.js         # Correios + ViaCEP
│   ├── checkout.js         # Fluxo de checkout
│   └── store.js            # Renderiza catálogo e filtros
├── images/products/        # Fotos dos produtos (.webp + .jpg)
├── worker.js               # Worker Cloudflare OPCIONAL
├── .github/workflows/
│   └── deploy.yml          # Deploy automático p/ GitHub Pages
├── .nojekyll               # Desativa Jekyll no Pages
└── README.md
```

---

## 🚀 Como configurar (passo a passo)

### 1. Preparar o GitHub Pages

1. Vá em [https://github.com/casadosbotoes/loja/settings/pages](https://github.com/casadosbotoes/loja/settings/pages)
2. Em **Source**, escolha **GitHub Actions**
3. Salve

### 2. Editar o `config.js`

Abra o arquivo `config.js` e preencha os campos marcados com `[PREENCHER]`:

- **`store.cepOrigem`**: CEP da loja (só dígitos, ex: `01000000`)
- **`store.enderecoCidade`**: Cidade/UF
- **`whatsapp.numero`**: número do WhatsApp no formato internacional
  (ex: `5511912345678` → +55 11 91234-5678)
- **`pix.chave`**: sua chave Pix (CPF, email, telefone ou aleatória)
- **`pix.tipoChave`**: `cpf` | `cnpj` | `email` | `phone` | `random`
- **`pix.nomeRecebedor`**: nome conforme aparece no banco (até 25 chars, sem acento)
- **`pix.cidadeRecebedor`**: cidade do titular (até 25 chars, sem acento)
- **`correios.contrato`** e **`correios.cartaoPostagem`**: cadastre em
  [correios.com.br/precos-e-prazos-de-encomendas-e-servicos-online](https://www.correios.com.br/precos-e-prazos-de-encomendas-e-servicos-online)

### 3. Commit e deploy automático

```
git add .
git commit -m "Configuração inicial da loja"
git push origin main
```

O GitHub Actions fará o deploy automaticamente. Em ~1 minuto seu site estará no ar em:
[https://casadosbotoes.github.io/loja/](https://casadosbotoes.github.io/loja/)

---

## 🛒 Como adicionar produtos

Edite o arquivo `products.js` e adicione um novo bloco no array `CDB_PRODUCTS`,
seguindo o formato dos produtos já existentes:

```js
{
  id: "novo-produto-1",                  // identificador único
  nome: "Botão Madeira Rustico 30mm",
  categoria: "madeira",                  // deve bater com uma das categorias
  preco: 24.00,
  unidade: "pacote com 10 unidades",
  quantidade: 10,
  descricao: "Botão rústico de madeira para projetos artesanais.",
  detalhes: ["Material: madeira natural", "Diâmetro: 30mm", "..."],
  destaque: false,                       // aparece com selo "Destaque"
  image: "novo-produto-1",              // nome do arquivo sem extensão
  dimensao: { pesoG: 80, comprimentoCm: 16, larguraCm: 11, alturaCm: 2 },
}
```

Adicione a foto em `images/products/novo-produto-1.webp` (e `.jpg` como fallback).

---

## 💳 Formas de pagamento

### Pix direto (padrão, sem taxa)
O QR Code é gerado no navegador a partir da sua chave Pix. O cliente paga
direto na sua conta — você não paga taxa de intermediário. **Sem necessidade de
backend.**

### Cartão e Pix Mercado Pago (opcional, com taxa)
Para aceitar cartão de crédito (até 12x) ou usar o QR Code dinâmico do Mercado
Pago, siga os passos abaixo para configurar o Cloudflare Worker (gratuito).

### WhatsApp (sem taxa)
O cliente finaliza o pedido pelo WhatsApp. Bom para casos onde ele tem
dúvidas sobre o produto ou o valor do frete.

---

## ⚙️ Cloudflare Worker (OPCIONAL)

> **Quando configurar:** quando você quiser **cartão de crédito** via Mercado
> Pago ou quando quiser um cálculo de frete 100% confiável (sem depender de
> proxy CORS público).

Siga os passos descritos no topo do arquivo `worker.js`. Resumindo:

1. Crie conta gratuita em [dash.cloudflare.com](https://dash.cloudflare.com)
2. Workers & Pages → Create application → Create Worker → nomeie `casadosbotoes-worker`
3. Edit code → cole TODO o conteúdo de `worker.js` → Deploy
4. Settings → Variables, adicione como **Secrets**:
   - `MP_ACCESS_TOKEN` = seu access token do Mercado Pago
     (pegue em [mercadopago.com.br/developers/panel/app](https://www.mercadopago.com.br/developers/panel/app))
   - `CORREIOS_CONTRATO` = seu contrato dos Correios
   - `CORREIOS_CARTAO` = seu cartão de postagem
5. Edite no topo do `worker.js` a constante `ORIGEM_PERMITIDA` para o seu domínio do GitHub Pages
6. Copie a URL do Worker (algo como `https://casadosbotoes-worker.seu-usuario.workers.dev`)
7. Em `config.js`, preencha:
   - `mercadoPago.workerUrl` = essa URL
   - `correios.workerUrl` = mesma URL
8. Commit + push → site atualizado

---

## 📦 Cálculo de frete (Correios)

O site consulta a API oficial dos Correios em tempo real. Estratégia:

1. Se `correios.workerUrl` estiver preenchido → usa o Worker (recomendado)
2. Senão → tenta chamada direta (vai falhar por CORS) → cai para proxy CORS público
3. Se tudo falhar → mostra mensagem amigável sugerindo WhatsApp

Dimensões padrão de pacote: `16 × 11 × 2 cm` (peso `0.05 kg` por pacote com 6 botões).
Ajuste por produto em `products.js` no campo `dimensao`.

---

## 🔒 Segurança

- **Access Token do Mercado Pago**: NUNCA colar em `config.js`. Use o Worker.
- **Contrato/Cartão dos Correios**: idem, use o Worker.
- **Chave Pix**: vai no `config.js` (é necessária para gerar o BR Code no navegador).
  Não há risco financeiro: ter a chave só permite receber pagamentos.
- O Worker valida a origem (`ORIGEM_PERMITIDA`) para impedir uso por outros sites.

---

## 🧪 Testando localmente

Como é tudo estático, basta abrir o `index.html` no navegador. Mas para evitar
problemas de CORS com ViaCEP, sirva via HTTP:

```bash
cd loja
python3 -m http.server 8080
# ou
npx serve .
```

Abra [http://localhost:8080](http://localhost:8080).

---

## 📋 TODO / Próximos passos

- [ ] Integrar com Mercado Livre (futuro)
- [ ] Página de pedido confirmado (via URL `?pedido=CDB123`)
- [ ] Cupons de desconto
- [ ] Lista de desejos
- [ ] Modo escuro

---

## 📝 Licença

Código próprio da Casa dos Botões. Bibliotecas externas (via CDN) mantêm suas
licenças originais.

Dúvidas? [Contate no WhatsApp](#) ou abra issue no repositório.
