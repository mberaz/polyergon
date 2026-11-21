export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextRequest, NextResponse } from 'next/server'
import { downloadLocalModel, installLocalCli, localWhisperStatus } from '@/lib/localWhisper'

export async function GET() {
  return NextResponse.json(await localWhisperStatus())
}

// Starts downloading the model, or (?action=install) installing whisper.cpp; poll GET for progress.
export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get('action') === 'install') installLocalCli()
  else downloadLocalModel()
  return NextResponse.json(await localWhisperStatus())
}
