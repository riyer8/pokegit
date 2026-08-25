# PokéGit

A Chrome extension that adds a small “Analyze Profile” panel on GitHub — public repos, rough engineering signals, Pokémon as visual shorthand, and a short summary of what stands out.

Playful, not a verdict on anyone’s ability.

## Try it

1. `chrome://extensions` → Developer mode → **Load unpacked** → this folder  
2. Open a GitHub profile  
3. Click **Analyze Profile**

Keys go in the panel Settings (⚙), or a local `.env` via `node scripts/sync-secrets.mjs`.  
`.env` and `secrets.local.js` are gitignored. Don’t zip/share this folder with those files present. Keys pasted in chat should be rotated.
