/** What a request brings that the records keep: its address, its device, and the server's own request id. */
export type RequestContext = { ip: string; userAgent: string | null; requestId: string };
