import { readFileSync } from 'fs'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

/** @type {import('next').NextConfig} */
const nextConfig = { env: { NEXT_PUBLIC_POLYERGON_VERSION: version } };

export default nextConfig;
