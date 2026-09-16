/**
 * Casa dos Botões — Gerador de BR Code do Pix (padrão EMV)
 * ----------------------------------------------------------------
 * Implementação client-side (pura, sem dependências) do "Pix Copy
 * and Paste" — gera o código BR Code no padrão EMV do Banco Central
 * do Brasil e o QR Code correspondente.
 *
 * Especificação oficial:
 *   https://www.bcb.gov.br/estabilidadefinanceira/pix
 *   Manual de Padrões para Iniciação do Pix (QR Code Estático)
 *
 * O QR Code gerado aqui é "estático": o valor é fixo por transação
 * (definido no checkout) e o pagamento cai direto na conta do
 * recebedor, sem passar pelo Mercado Pago (sem taxa).
 *
 * Para QR Code dinâmico via Mercado Pago (com taxa), ver checkout.js
 * e worker.js (Cloudflare Worker opcional).
 */

(function (global) {
  'use strict';

  /* ---------- Helpers TLV ---------- */
  // Cada campo é codificado como: ID (2 dígitos) + Tamanho (2 dígitos) + Valor
  // O tamanho do valor é uma string de 2 dígitos (com leading zero se necessário).
  function pad2(n) {
    n = String(n);
    return n.length < 2 ? '0'.repeat(2 - n.length) + n : n;
  }

  function tlv(id, value) {
    if (value === null || value === undefined || value === '') return '';
    value = String(value);
    // Remove caracteres não-ASCII e quebras de linha
    value = value.replace(/[\r\n]+/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // Limita ao tamanho máximo permitido (99 para valor único)
    if (value.length > 99) value = value.slice(0, 99);
    return pad2(id) + pad2(value.length) + value;
  }

  function tlvNoSizeLimit(id, value) {
    if (value === null || value === undefined || value === '') return '';
    value = String(value).replace(/[\r\n]+/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return pad2(id) + pad2(value.length) + value;
  }

  /* ---------- CRC16-CCITT (polinômio 0x1021) ---------- */
  // O Pix usa CRC16-CCITT com init 0xFFFF para o campo 63.
  function crc16(payload) {
    let crc = 0xFFFF;
    for (let i = 0; i < payload.length; i++) {
      crc ^= payload.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) {
        crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  /* ---------- Função principal: gera BR Code ---------- */
  // Parâmetros:
  //   chave        - chave Pix do recebedor (CPF, email, telefone, aleatória)
  //   tipoChave    - "cpf" | "cnpj" | "email" | "phone" | "random"
  //   nomeRecebedor - máx 25 chars, sem acentos
  //   cidadeRecebedor - máx 25 chars, sem acentos
  //   valor        - número (ex: 20.00). Opcional. Se null, sem valor (valor livre)
  //   identificador - máx 25 chars alfanuméricos. Opcional.
  //   descricao    - máx 72 chars. Opcional.
  function gerarBRCode({ chave, tipoChave, nomeRecebedor, cidadeRecebedor, valor, identificador, descricao }) {
    // Sanitiza nome e cidade (remove acentos, uppercase, limita 25 chars)
    nomeRecebedor = (nomeRecebedor || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 25);
    cidadeRecebedor = (cidadeRecebedor || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 25);

    // Trata a chave conforme o tipo
    let chavePix = (chave || '').trim();
    if (tipoChave === 'phone') {
      // formato internacional, ex: +5511912345678 → +5511912345678
      if (!chavePix.startsWith('+')) chavePix = '+' + chavePix;
    }
    if (tipoChave === 'cpf') chavePix = chavePix.replace(/\D/g, '');
    if (tipoChave === 'cnpj') chavePix = chavePix.replace(/\D/g, '');

    // --- Campo 26: Merchant Account Information (Pix) ---
    // Sub-campos:
    //   00 - GUI: "br.gov.bcb.pix"
    //   01 - chave Pix
    //   02 - descrição (opcional)
    let mai = tlv('00', 'br.gov.bcb.pix') + tlv('01', chavePix);
    if (descricao) mai += tlv('02', descricao);
    // campo 26: tamanho limitado a 99 (vários subcampos juntos)
    if (mai.length > 99) {
      // se exceder, corta a descrição (campo 02)
      const gui = tlv('00', 'br.gov.bcb.pix');
      const chavePart = tlv('01', chavePix);
      const restante = 99 - gui.length - chavePart.length;
      const descTlv = restante > 8 ? tlv('02', descricao.slice(0, restante - 8)) : '';
      mai = gui + chavePart + descTlv;
    }
    const campo26 = tlvNoSizeLimit('26', mai);

    // --- Campo 62: Additional Data Field (referência) ---
    let adf = '';
    if (identificador) {
      // sanitize identificador: alfanumérico, máx 25
      identificador = identificador.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 25);
      adf = tlv('05', identificador);
    }
    const campo62 = tlvNoSizeLimit('62', adf);

    // --- Monta o payload (sem o CRC ainda) ---
    let payload = '';
    payload += tlv('00', '01');                  // Payload Format Indicator
    payload += tlv('01', '12');                  // Point of Initiation Method (estático = "12")
    payload += campo26;                          // Merchant Account Info
    payload += tlv('52', '0000');                // Merchant Category Code
    payload += tlv('53', '986');                 // Transaction Currency: BRL (986)
    if (valor !== null && valor !== undefined && !isNaN(valor)) {
      // Formata o valor com 2 casas decimais (ex: 20.00)
      const valorStr = Number(valor).toFixed(2);
      payload += tlv('54', valorStr);
    }
    payload += tlv('58', 'BR');                   // Country Code
    payload += tlv('59', nomeRecebedor);          // Merchant Name
    payload += tlv('60', cidadeRecebedor);       // Merchant City
    payload += campo62;                           // Additional Data
    payload += '6304';                           // CRC16: ID 63, length 4
    payload += crc16(payload);

    return payload;
  }

  /* ---------- Gera QR Code (data URL) ---------- */
  // Usa a lib externa qrcode-generator carregada via CDN.
  // Se ela não estiver disponível, retorna null e o chamador pode exibir
  // apenas o código "Copy and Paste".
  function gerarQRCodeDataURL(brCode, sizePixels) {
    sizePixels = sizePixels || 240;
    if (typeof qrcode === 'undefined') {
      console.warn('[pix] lib qrcode-generator não carregada');
      return null;
    }
    try {
      // typeNumber 0 = autodetecta o menor tipo que comporta o dado
      // errorCorrectionLevel 'M' = nível médio
      const qr = qrcode(0, 'M');
      qr.addData(brCode);
      qr.make();
      // createDataURL aceita: cellSize, margin
      const cellSize = Math.max(3, Math.floor(sizePixels / 25));
      const dataUrl = qr.createDataURL(cellSize, 2);
      return dataUrl;
    } catch (e) {
      console.error('[pix] erro ao gerar QR:', e);
      return null;
    }
  }

  /* ---------- API pública ---------- */
  global.CDBPix = {
    gerarBRCode: gerarBRCode,
    gerarQRCodeDataURL: gerarQRCodeDataURL,
    crc16: crc16,
  };
})(window);
