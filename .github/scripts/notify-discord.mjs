// =========================================================================================================
// Send plain Markdown updates to the configured Discord conversation.
// =========================================================================================================

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// =========================================================================================================
// Message Formatting
// =========================================================================================================

const shortText = (text, limit) => String(text || '').split('\n')[0].replace(/[`\r]/g, "'").slice(0, limit)

export function formatMessage(eventName, event) {
  if (eventName === 'push') {
    const commits = event.commits.slice(0, 5).map(commit =>
      `- [\`${commit.id.slice(0, 7)}\`](${event.repository.html_url}/commit/${commit.id}) ${shortText(commit.message, 120)}`,
    )
    return [
      '**Nuevos cambios en PetSuite**',
      `**Rama:** \`${shortText(event.ref.replace('refs/heads/', ''), 80)}\` · **Por:** ${shortText(event.pusher.name, 80)}`,
      ...commits,
      ...(event.commits.length > 5 ? [`- Y ${event.commits.length - 5} commits más.`] : []),
      `[Ver cambios](${event.compare || event.repository.html_url})`,
    ].join('\n').slice(0, 2000)
  }

  const run = event.workflow_run
  if (run.name === 'Salud') {
    return [
      '**La versión real de PetSuite o su base de datos no responden**',
      'El control de /healthz falló tres veces seguidas. Revisa Vercel y Supabase (la base del plan gratuito puede estar pausada).',
      `[Revisar el control](${run.html_url})`,
    ].join('\n')
  }
  return [
    '**Falló la publicación de PetSuite en GitHub Pages**',
    `**Rama:** \`${shortText(run.head_branch, 80)}\` · **Commit:** \`${run.head_sha.slice(0, 7)}\``,
    `[Revisar el fallo](${run.html_url})`,
  ].join('\n')
}

// =========================================================================================================
// Delivery
// =========================================================================================================

async function main() {
  const { DISCORD_TOKEN: token, DISCORD_CHANNEL: channel, GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: eventPath } = process.env
  if (!token || !/^\d{17,20}$/.test(channel || '')) throw new Error('Missing Discord token or invalid channel ID')

  const event = JSON.parse(readFileSync(eventPath, 'utf8'))
  const response = await fetch(`https://discord.com/api/v10/channels/${channel}/messages`, {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: formatMessage(eventName, event), allowed_mentions: { parse: [] } }),
  })
  if (!response.ok) throw new Error(`Discord rejected the message (HTTP ${response.status})`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => { console.error(error); process.exitCode = 1 })
}
