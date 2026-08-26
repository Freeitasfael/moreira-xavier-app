/**
 * Barrel export para scrapers do TJMG
 *
 * Nota: Os scrapers Playwright (consulta pública, autenticado, monitor DJE)
 * foram desativados por não funcionarem no Render (sem headless browser).
 * O TJMG legado (www4.tjmg.jus.br) bloqueia requisições HTTP com captcha.
 *
 * A fonte de dados primária e única é o DataJud (API REST do CNJ).
 */

// Arquivos mantidos mas não exportados:
// - tjmg-consulta-publica.ts  → requer Playwright
// - tjmg-autenticado.ts       → requer Playwright
// - tjmg-api.client.ts        → bloqueado por captcha
// - monitor-dje.ts            → requer Playwright
