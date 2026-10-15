import type { APIRoute } from 'astro';
import { clearSession } from '../../lib/admin-server';

export const prerender = false;

function leave(context: Parameters<APIRoute>[0]): Response {
  clearSession(context.cookies, context.request);
  return context.redirect('/admin/login');
}

export const GET: APIRoute = (context) => leave(context);
export const POST: APIRoute = (context) => leave(context);
