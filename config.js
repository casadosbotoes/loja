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
    // Endereço real de origem das encomendas (Ribeirão Preto - SP)
    cepOrigem: "14010100",
    enderecoCidade: "Ribeirão Preto / SP",
    enderecoCompleto: "Rua Visconde de Inhaúma, 580 - Sala 409 - Centro - Ribeirão Preto / SP - CEP 14010-100",
  },

  /* ---------- Contato / WhatsApp ---------- */
  whatsapp: {
    // Número do WhatsApp da loja em formato internacional, só dígitos
    // Formato: 55 + DDD + número (ex: 55 16 99232-8650 → "5516992328650")
    numero: "5516992328650",
    mensagemPadrao: "Olá! Tenho interesse em produtos da Casa dos Botões.",
  },

  /* ---------- PIX (estático, gerado no navegador) ---------- */
  // Esta é a forma mais simples: o QR Code do Pix é gerado no próprio
  // navegador a partir da chave Pix da loja. O cliente paga direto
  // na conta, sem intermediários e sem taxa. Não usa Mercado Pago.
  pix: {
    // Chave Pix da loja (telefone) — formato: 55 + DDD + número (só dígitos)
    // O BR Code gera o QR Code no padrão EMV do Banco Central usando
    // "+5516992328650" como chave no QR Code.
    chave: "5516992328650",
    tipoChave: "phone", // "cpf" | "cnpj" | "email" | "phone" | "random"
    // [PREENCHER] Nome do recebedor conforme está no banco (até 25 chars, sem acento)
    nomeRecebedor: "CASA DOS BOTOES",
    cidadeRecebedor: "RIBEIRAO PRETO", // máximo 25 chars, sem acento
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
    // Credenciais da API dos Correios (OPCIONAL — só preencha se tiver contrato).
    // Cadastre-se em https://www.correios.com.br/precos-e-prazos-de-encomendas-e-servicos-online
    // Pegue: contrato (10 dígitos), cartão de postagem (10 dígitos), senha.
    // Se ficar vazio, o site usa serviços SEM contrato (04510 PAC / 04014 SEDEX)
    // via API pública — funciona, mas com preços de balcão (sem desconto de contrato).
    contrato: "",
    cartaoPostagem: "",
    // Se preenchido, usa o worker.js para fazer a chamada com CORS resolvido.
    // RECOMENDADO em produção para 100% de confiabilidade.
    workerUrl: "", // ex: "https://casadosbotoes-worker.seu-usuario.workers.dev"
    // Serviços de entrega disponíveis.
    // SEM contrato (qualquer um pode usar): 04510 PAC, 04014 SEDEX
    // COM contrato (precisa preencher acima): 03298 PAC, 03220 SEDEX
    servicos: [
      { codigo: "04510", nome: "PAC", descricao: "Econômico, 5-9 dias úteis" },
      { codigo: "04014", nome: "SEDEX", descricao: "Rápido, 1-3 dias úteis" },
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

  /* ---------- Frete fixo (fallback) ----------
   * Usado SOMENTE quando TODAS as estratégias online falham
   * (API dos Correios fora do ar, proxy CORS bloqueado, etc).
   * Garante que o cliente consiga finalizar a compra mesmo sem
   * frete online. Os valores devem ser revisados conforme a média
   * praticada pelos Correios para a sua região de origem.
   */
  freteFixoFallback: {
    ativo: true,
    aviso: "Frete estimado (valor online indisponível). Confirmaremos o valor final no WhatsApp.",
    valores: [
      { codigo: "04510", nome: "PAC", descricao: "Econômico, 5-9 dias úteis", valor: 10.00, prazo: 7 },
      { codigo: "04014", nome: "SEDEX", descricao: "Rápido, 1-3 dias úteis", valor: 15.00, prazo: 3 },
    ],
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
