/**
 * Casa dos Botões - Catálogo de produtos
 * ------------------------------------------------------------------
 * Para ADICIONAR mais produtos: copie um bloco abaixo, mude os campos.
 * Para REMOVER: apague o bloco.
 *
 * Campos:
 *   id          - identificador único (não pode repetir)
 *   nome        - nome exibido no card
 *   categoria   - deve ser uma das categorias em CDB_CATEGORIES
 *   preco       - valor numérico (ex: 20.00)
 *   precoAntigo - opcional, se tiver promoção (ex: 24.00). Remova se não tiver.
 *   unidade     - "pacote com 6", "pacote com 12", "unidade", etc.
 *   quantidade  - nº de unidades dentro de 1 pacote (para foto/info)
 *   descricao   - texto curto exibido no card e na modal
 *   detalhes    - lista de bullets exibidos na modal
 *   destaque    - true para marcar como "Destaque" no card
 *   promocao    - true para mostrar selo "Promoção"
 *   image       - nome do arquivo dentro de images/products/ (sem extensão)
 *                 usa .webp com fallback .jpg
 *   dimensões   - opcional, usado para o cálculo de frete (peso em gramas)
 *                 se faltar, usa o padrão do config.js
 */

window.CDB_CATEGORIES = [
  { id: "plastico", nome: "Botões de Plástico", icone: "●", descricao: "Variedade de cores e tamanhos" },
  { id: "madeira",  nome: "Botões de Madeira",  icone: "◐", descricao: "Rústicos e artesanais" },
  { id: "metal",    nome: "Botões de Metal",    icone: "◍", descricao: "Dourados, prateados e envelhecidos" },
  { id: "infantis", nome: "Infantis",           icone: "☺", descricao: "Botões divertidos e coloridos" },
  { id: "linhas",   nome: "Linhas",             icone: "〜", descricao: "Para costura e bordado" },
  { id: "aviamentos", nome: "Aviamentos",       icone: "✕", descricao: "Zíperes, velcro, elásticos" },
  { id: "agulhas",  nome: "Agulhas",            icone: "↑", descricao: "Para todas as máquinas e mãos" },
  { id: "kits",     nome: "Kits",               icone: "▦", descricao: "Pacotes completos para projetos" },
];

window.CDB_PRODUCTS = [
  {
    id: "botao-metal-trancado-25mm",
    nome: "Botão Metal Trançado 25mm",
    categoria: "metal",
    preco: 20.00,
    unidade: "pacote com 6 unidades",
    quantidade: 6,
    descricao: "Botão dourado trançado em relevo, ideal para blazers, casacos e peças de destaque.",
    detalhes: [
      "Material: metal dourado",
      "Diâmetro: 25mm",
      "Conteúdo: 6 unidades",
      "Acabamento brilhante com detalhe trançado",
    ],
    destaque: true,
    image: "botao-000",
    dimensao: { pesoG: 50, comprimentoCm: 16, larguraCm: 11, alturaCm: 2 },
  },
  {
    id: "botao-metal-liso-23mm",
    nome: "Botão Metal Liso 23mm",
    categoria: "metal",
    preco: 20.00,
    unidade: "pacote com 6 unidades",
    quantidade: 6,
    descricao: "Botão dourado liso com bordas arredondadas, clássico e versátil para qualquer projeto.",
    detalhes: [
      "Material: metal dourado",
      "Diâmetro: 23mm",
      "Conteúdo: 6 unidades",
      "Disponível em pacotes de 6 ou 12",
    ],
    destaque: true,
    image: "botao-001",
    dimensao: { pesoG: 50, comprimentoCm: 16, larguraCm: 11, alturaCm: 2 },
  },
  {
    id: "botao-metal-decorado-20mm",
    nome: "Botão Metal Decorado 20mm",
    categoria: "metal",
    preco: 24.00,
    unidade: "pacote com 6 unidades",
    quantidade: 6,
    descricao: "Botão dourado com detalhe decorativo central, perfeito para camisas e vestidos.",
    detalhes: [
      "Material: metal dourado",
      "Diâmetro: 20mm",
      "Conteúdo: 6 unidades",
      "Detalhe decorativo em relevo",
    ],
    destaque: true,
    image: "botao-002",
    dimensao: { pesoG: 50, comprimentoCm: 16, larguraCm: 11, alturaCm: 2 },
  },
  {
    id: "botao-metal-preto-22mm",
    nome: "Botão Metal Preto com Detalhe 22mm",
    categoria: "metal",
    preco: 20.00,
    unidade: "pacote com 6 unidades",
    quantidade: 6,
    descricao: "Botão preto com detalhe dourado, sofisticado para peças formais.",
    detalhes: [
      "Material: metal com acabamento preto",
      "Diâmetro: 22mm",
      "Conteúdo: 6 unidades",
      "Detalhe dourado central",
    ],
    destaque: false,
    image: "botao-003",
    dimensao: { pesoG: 50, comprimentoCm: 16, larguraCm: 11, alturaCm: 2 },
  },
  {
    id: "botao-metal-fino-20mm",
    nome: "Botão Metal Fino 20mm",
    categoria: "metal",
    preco: 20.00,
    unidade: "pacote com 6 unidades",
    quantidade: 6,
    descricao: "Botão dourado de perfil fino, discreto e elegante para roupas finas.",
    detalhes: [
      "Material: metal dourado",
      "Diâmetro: 20mm",
      "Conteúdo: 6 unidades",
      "Perfil fino e discreto",
    ],
    destaque: false,
    image: "botao-004",
    dimensao: { pesoG: 50, comprimentoCm: 16, larguraCm: 11, alturaCm: 2 },
  },
  {
    id: "botao-metal-pedra-25mm",
    nome: "Botão Metal com Pedra Branca 25mm",
    categoria: "metal",
    preco: 20.00,
    unidade: "pacote com 6 unidades",
    quantidade: 6,
    descricao: "Botão dourado com pedra branca central, para ocasiões especiais e festas.",
    detalhes: [
      "Material: metal dourado + pedra sintética branca",
      "Diâmetro: 25mm",
      "Conteúdo: 6 unidades",
      "Brilho sofisticado para festas",
    ],
    destaque: true,
    promocao: true,
    image: "botao-005",
    dimensao: { pesoG: 50, comprimentoCm: 16, larguraCm: 11, alturaCm: 2 },
  },
  {
    id: "botao-metal-preto-borda-30mm",
    nome: "Botão Metal Preto com Borda Dourada 30mm",
    categoria: "metal",
    preco: 20.00,
    unidade: "pacote com 6 unidades",
    quantidade: 6,
    descricao: "Botão grande com borda dourada e centro preto, ideal para casacos e peças de inverno.",
    detalhes: [
      "Material: metal com acabamento preto + borda dourada",
      "Diâmetro: 30mm",
      "Conteúdo: 6 unidades",
      "Tamanho grande para casacos",
    ],
    destaque: false,
    image: "botao-006",
    dimensao: { pesoG: 60, comprimentoCm: 16, larguraCm: 11, alturaCm: 2 },
  },
  {
    id: "kit-2-botao-metal-22mm",
    nome: "Kit Duplo Botão Metal 22mm",
    categoria: "kits",
    preco: 20.00,
    unidade: "2 pacotes com 6 unidades cada (12 un total)",
    quantidade: 12,
    descricao: "Kit com 2 pacotes de 6 botões dourados de 22mm, ideal para quem costuma vários projetos.",
    detalhes: [
      "Material: metal dourado",
      "Diâmetro: 22mm",
      "Conteúdo: 2 pacotes com 6 unidades (12 total)",
      "Economia em kit duplo",
    ],
    destaque: true,
    image: "botao-007",
    dimensao: { pesoG: 100, comprimentoCm: 16, larguraCm: 11, alturaCm: 4 },
  },
  {
    id: "botao-metal-ondulado-25mm",
    nome: "Botão Metal Ondulado 25mm",
    categoria: "metal",
    preco: 20.00,
    unidade: "pacote com 6 unidades",
    quantidade: 6,
    descricao: "Botão dourado com bordas onduladas, charme vintage para projetos artesanais.",
    detalhes: [
      "Material: metal dourado",
      "Diâmetro: 25mm",
      "Conteúdo: 6 unidades",
      "Estilo vintage",
    ],
    destaque: false,
    image: "botao-008",
    dimensao: { pesoG: 50, comprimentoCm: 16, larguraCm: 11, alturaCm: 2 },
  },
];
