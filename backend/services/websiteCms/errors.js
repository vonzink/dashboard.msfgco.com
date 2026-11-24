class CmsError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const fail = (status, code) => { throw new CmsError(status, code); };
module.exports = { CmsError, fail };
