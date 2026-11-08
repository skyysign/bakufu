import { GamePage, type GameSearchParams } from '../game-page';
export const dynamic = 'force-dynamic';
export default function Page({ searchParams }: { searchParams: GameSearchParams }) {
  return <GamePage screen="trades" searchParams={searchParams} />;
}
