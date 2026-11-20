import type { RequestContext } from '../lib/context.js';
import { jsonResponse, type ApiResponse } from '../lib/http.js';

export async function handleHealth(ctx: RequestContext): Promise<ApiResponse> {
  return jsonResponse(200, { status: 'ok', requestId: ctx.requestId });
}
