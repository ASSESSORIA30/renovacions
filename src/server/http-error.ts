/** Error amb codi HTTP (sense dependències: el poden fer servir mòduls que no són només de servidor, com el lector de PDF). */
export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
