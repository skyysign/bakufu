import { healthResponse } from '../../../../lib/health';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ check: string }> }) {
  return healthResponse((await context.params).check);
}
