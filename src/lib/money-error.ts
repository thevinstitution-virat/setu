/** A money / document rule was broken; status is the HTTP status to answer with. */
export class MoneyError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}
