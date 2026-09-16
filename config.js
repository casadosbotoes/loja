/**
 * Casa dos Botões - Configuração da loja
 * ------------------------------------------------------------------
 * Edite este arquivo com os dados reais da sua loja. Ele é o ÚNICO
 * arquivo que você precisa alterar para personalizar a loja.
 *
 * Campos marcados com [PREENCHER] precisam dos seus dados.
 */

window.CDB_CONFIG = {
  /* ---------- Identidade da loja ---------- */
  store: {
    name: "Casa dos Botões",
    slogan: "Tudo para sua criatividade",
    highlight: "Botões para todas as suas criações",
    cepOrigem: "14015130", // CEP do Centro de Ribeirão Preto (14015-130)
    enderecoCidade: "Ribeirão Preto / SP",
  },

  /* ---------- Contato / WhatsApp ---------- */
  whatsapp: {
    // Número do WhatsApp da loja em formato internacional, só dígitos
    // Formato: 55 + DDD + número (ex: 55 16 99184-2936 → "5516991842936")
    numero: "5516991842936",
    mensagemPadrao: "Olá! Tenho interesse em produtos da Casa dos Botões.",
  },

  /* ---------- PIX (estático, gerado no navegador) ---------- */
  // Esta é a forma mais simples: o QR Code do Pix é gerado no próprio
  // navegador a partir da chave Pix da loja. O cliente paga direto
  // na conta, sem intermediários e sem taxa. Não usa Mercado Pago.
  pix: {
    // Chave Pix da loja (telefone) — formato: 55 + DDD + número (só dígitos)
    // O BR Code gera o QR Code no padrão EMV do Banco Central usando
    // "+5516991842936" como chave no QR Code.
    chave: "5516991842936",
    tipoChave: "phone", // "cpf" | "cnpj" | "email" | "phone" | "random"
    // [PREENCHER] Nome do recebedor conforme está no banco (até 25 chars, sem acento)
    nomeRecebedor: "CASA DOS BOTOES",
    cidadeRecebedor: "RIBEIRAO PRETO",
    // Identificador da transação (opcional, máximo 25 chars alfanuméricos)
    // Vai ser preenchido dinamicamente com o número do pedido
    identificadorPrefix: "CDB",
  },

  /* ---------- Mercado Pago (opcional - para cartão e Pix via MP) ---------- */
  // O site funciona perfeitamente só com Pix direto (acima).
  // Se quiser aceitar cartão de crédito ou usar o Pix do Mercado Pago,
  // preencha abaixo e faça o deploy do Cloudflare Worker em worker.js
  mercadoPago: {
    // [OPCIONAL] Public Key do MP (front-end). Pegue em:
    // https://www.mercadopago.com.br/developers/panel/app
    publicKey: "",
    // [OPCIONAL] Access Token do MP (NÃO colar aqui no front se for site público!)
    // Use o worker.js em produção. Este campo serve apenas para teste local.
    accessToken: "",
    // URL do Cloudflare Worker que faz proxy seguro para a API do MP
    // Se vazio, os botões "Cartão" e "Pix MP" ficam ocultos.
    workerUrl: "", // ex: "https://casadosbotoes-worker.seu-usuario.workers.dev"
  },

  /* ---------- Correios (cálculo de frete) ---------- */
  correios: {
    // [OPCIONAL] Credenciais da API oficial dos Correios.
    // Se preenchidas + workerUrl, usa API oficial (precisa fazer deploy
    // do worker.js no Cloudflare). Cadastre em:
    // https://www.correios.com.br/precos-e-prazos-de-encomendas-e-servicos-online
    contrato: "",
    cartaoPostagem: "",
    workerUrl: "", // ex: "https://casadosbotoes-worker.seu-usuario.workers.dev"

    // Se contrato/worker não preenchidos, usa a TABELA INTERNA abaixo.
    // Sempre funciona, sem precisar de credenciais dos Correios.
    // Valores base 2025 (por região do Brasil - primeiro dígito do CEP).
    // EDITE os valores conforme sua realidade. Formato:
    //   "<1º dígito do CEP>": { regiao, pac, sedex, prazoPac, prazoSedex }
    // Os valores são por pacote de até 0,3kg (1 pacote com 6 botões).
    // Pedidos maiores têm acréscimo de 30% por pacote adicional.
    // Pedidos para a MESMA REGIÃO da origem têm 15% de desconto.
    tabelaFrete: {
      "0": { regiao: "Grande São Paulo",                  pac: 12.90, sedex: 19.90, prazoPac: 4,  prazoSedex: 1 },
      "1": { regiao: "Interior SP + RJ + MG + ES",         pac: 16.90, sedex: 26.90, prazoPac: 6,  prazoSedex: 2 },
      "2": { regiao: "RJ + ES",                            pac: 17.90, sedex: 27.90, prazoPac: 6,  prazoSedex: 2 },
      "3": { regiao: "Minas Gerais + Bahia",               pac: 19.90, sedex: 32.90, prazoPac: 7,  prazoSedex: 3 },
      "4": { regiao: "BA + SE + AL + PE",                  pac: 22.90, sedex: 38.90, prazoPac: 8,  prazoSedex: 4 },
      "5": { regiao: "PE + PB + RN + CE",                  pac: 24.90, sedex: 42.90, prazoPac: 9,  prazoSedex: 4 },
      "6": { regiao: "Norte (PA, AM, AC, RO, RR, AP)",     pac: 34.90, sedex: 62.90, prazoPac: 12, prazoSedex: 6 },
      "7": { regiao: "Centro-Oeste (DF, GO, TO, MT, MS)", pac: 26.90, sedex: 47.90, prazoPac: 10, prazoSedex: 4 },
      "8": { regiao: "Sul (PR, SC)",                       pac: 19.90, sedex: 32.90, prazoPac: 6,  prazoSedex: 3 },
      "9": { regiao: "Rio Grande do Sul",                  pac: 22.90, sedex: 38.90, prazoPac: 7,  prazoSedex: 3 },
    },

    // Serviços de entrega disponíveis (mostrados no checkout)
    servicos: [
      { codigo: "03298", nome: "PAC",  descricao: "Econômico, 4-12 dias úteis" },
      { codigo: "03220", nome: "SEDEX", descricao: "Rápido, 1-6 dias úteis" },
    ],

    // Dimensões padrão do pacote (1 pacote pequeno com botões)
    // O JS multiplica peso/altura conforme quantidade de produtos no carrinho
    pacote: {
      pesoBaseKg: 0.05, // peso de 1 pacote com 6 botões
      comprimentoCm: 16,
      larguraCm: 11,
      alturaCm: 2,
    },
  },

  /* ---------- Retirada no local ---------- */
  // Cliente pode optar por retirar o pedido pessoalmente em vez de pagar frete.
  // Aparece como opção de frete no checkout (valor R$ 0,00 - 'Grátis').
  retirada: {
    ativo: true,
    titulo: "Retirar no local (Ribeirão Preto)",
    descricao: "Você retira pessoalmente. Endereço completo enviado no WhatsApp após confirmação do pagamento.",
    valor: 0, // grátis
    prazo: "Combinar com a loja",
  },

  /* ---------- E-mail de pedidos (Web3Forms) ---------- */
  // Receba cada pedido também por e-mail (além do WhatsApp).
  // Serviço gratuito, sem backend. Os pedidos chegam no seu e-mail.
  //
  // COMO CONFIGURAR (3 passos):
  // 1. Acesse https://web3forms.com no navegador
  // 2. Digite seu e-mail onde quer receber os pedidos
  // 3. Você recebe um e-mail da Web3Forms com seu ACCESS KEY (UUID)
  //    Cole esse access key abaixo (entre as aspas).
  //
  // Enquanto o access key estiver vazio, o e-mail fica desativado
  // e apenas o WhatsApp será usado.
  email: {
    ativo: true,
    accessKey: "639fa091-8dcc-4d78-99bb-58d003f819a3",
    para: "casadebotao1@gmail.com",
    assunto: "🧵 Novo pedido - Casa dos Botões",
  },

  /* ---------- Frete grátis ---------- */
  freteGratis: {
    ativo: true,
    valorMinimo: 199.0, // acima de R$199,00 o frete é grátis
  },

  /* ---------- Configurações visuais ---------- */
  theme: {
    corVinho: "#6b1f2a",
    corVinhoEscuro: "#4a1620",
    corVinhoClaro: "#8b3a48",
    corCreme: "#f6ecd9",
    corCremeEscuro: "#ead9b8",
    corMadeira: "#8b5a3c",
    corMadeiraClara: "#c8956d",
  },

  /* ---------- Opções de checkout ---------- */
  checkout: {
    // Formas de pagamento disponíveis (ordem dos botões)
    metodos: ["pix", "cartao", "whatsapp"],
    // Exige CEP para calcular frete antes de finalizar
    exigirCep: true,
    // Mensagem de aviso mostrada no checkout
    aviso: "Pedidos confirmados em até 24h via WhatsApp. Frete calculado no checkout.",
  },
};
