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
    highlight: "+ de 13 mil botões para você!",
    cepOrigem: "01000000", // [PREENCHER] CEP de origem das encomendas (apenas dígitos)
    enderecoCidade: "São Paulo / SP", // [PREENCHER] cidade de origem
  },

  /* ---------- Contato / WhatsApp ---------- */
  whatsapp: {
    // [PREENCHER] Número do WhatsApp da loja em formato internacional, só dígitos
    // Ex: 11 91234-5678 → "5511912345678"
    numero: "5511999999999",
    mensagemPadrao: "Olá! Tenho interesse em produtos da Casa dos Botões.",
  },

  /* ---------- PIX (estático, gerado no navegador) ---------- */
  // Esta é a forma mais simples: o QR Code do Pix é gerado no próprio
  // navegador a partir da chave Pix da loja. O cliente paga direto
  // na conta, sem intermediários e sem taxa. Não usa Mercado Pago.
  pix: {
    // [PREENCHER] Chave Pix da loja (CPF, e-mail, telefone ou aleatória)
    chave: "casadosbotoes@email.com",
    tipoChave: "email", // "cpf" | "cnpj" | "email" | "phone" | "random"
    // [PREENCHER] Nome do recebedor conforme está no banco
    nomeRecebedor: "CASA DOS BOTOES",
    cidadeRecebedor: "SAO PAULO",
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
    // [PREENCHER] Credenciais da API dos Correios
    // Cadastre-se em https://www.correios.com.br/precos-e-prazos-de-encomendas-e-servicos-online
    // Pegue: contrato (10 dígitos), cartão de postagem (10 dígitos), senha
    contrato: "",
    cartaoPostagem: "",
    // Se preenchido, usa o worker.js para fazer a chamada com CORS resolvido.
    workerUrl: "", // se vazio, tenta direto + fallback CORS público
    // Serviços de entrega disponíveis (PAC + SEDEX)
    servicos: [
      { codigo: "03298", nome: "PAC", descricao: "Econômico, 5-9 dias úteis" },
      { codigo: "03220", nome: "SEDEX", descricao: "Rápido, 1-3 dias úteis" },
    ],
    // Dimensões padrão do pacote (1 pacote pequeno com botões)
    // Ajuste conforme o pedido: o JS multiplica peso por quantidade
    pacote: {
      pesoBaseKg: 0.05, // peso de 1 pacote com 6 botões
      comprimentoCm: 16,
      larguraCm: 11,
      alturaCm: 2,
    },
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
