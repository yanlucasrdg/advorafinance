export type CNJValidation =
  | {
      ok: true;
      clean: string;
      formatted: string;
      segmento: string;
      tribunal: string;
      ano: string;
    }
  | {
      ok: false;
      reason: "EMPTY" | "LENGTH" | "YEAR" | "SEGMENT" | "DV";
      message: string;
    };

/**
 * Valida e normaliza a numeração única de processos definida pela
 * Resolução CNJ nº 65/2008: NNNNNNN-DD.AAAA.J.TR.OOOO.
 */
export function validateCNJ(raw: string): CNJValidation {
  const trimmed = (raw ?? "").trim();

  if (!trimmed) {
    return {
      ok: false,
      reason: "EMPTY",
      message: "Informe o número CNJ do processo.",
    };
  }

  const clean = trimmed.replace(/\D/g, "");

  if (clean.length !== 20) {
    return {
      ok: false,
      reason: "LENGTH",
      message: `Número CNJ deve ter 20 dígitos (recebi ${clean.length}). Formato: NNNNNNN-DD.AAAA.J.TT.OOOO`,
    };
  }

  const numero = clean.slice(0, 7);
  const dv = clean.slice(7, 9);
  const ano = clean.slice(9, 13);
  const segmento = clean.slice(13, 14);
  const tribunal = clean.slice(14, 16);
  const origem = clean.slice(16, 20);

  const anoNumerico = Number(ano);
  const proximoAno = new Date().getFullYear() + 1;

  if (anoNumerico < 1900 || anoNumerico > proximoAno) {
    return {
      ok: false,
      reason: "YEAR",
      message: `Ano do processo inválido (${ano}).`,
    };
  }

  if (!/^[1-9]$/.test(segmento)) {
    return {
      ok: false,
      reason: "SEGMENT",
      message: `Segmento do Judiciário inválido (${segmento}).`,
    };
  }

  // Módulo 97 base 10, conforme a Resolução CNJ nº 65/2008.
  const base = `${numero}${ano}${segmento}${tribunal}${origem}`;
  let resto = 0;

  for (const digito of base) {
    resto = (resto * 10 + Number(digito)) % 97;
  }

  const dvEsperado = 98 - ((resto * 100) % 97);

  if (dvEsperado !== Number(dv)) {
    return {
      ok: false,
      reason: "DV",
      message: "Dígitos verificadores não conferem. Confira a digitação do número CNJ.",
    };
  }

  return {
    ok: true,
    clean,
    formatted: `${numero}-${dv}.${ano}.${segmento}.${tribunal}.${origem}`,
    segmento,
    tribunal,
    ano,
  };
}
