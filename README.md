# Pomodoro Plants

A VS Code/Cursor extension that gamifies focus sessions with pixel art plants. Watch your plant grow as you work through Pomodoro sessions, collect tomatoes, and enjoy relaxing break scenes.

## Features

### Plant Growth
- 10 unique growth stages from dirt to fruit-bearing plant
- Pixel art graphics with smooth animations
- Hover over progress bar to preview upcoming stages

### Pomodoro Timer
- Customizable session duration (default: 20 minutes)
- Focus tracking - timer only progresses when editor is focused
- Visual feedback with progress bar and stage labels

### Break Scenes
Four farmer-themed break activities, randomly selected:
- Fishing by the pond
- Resting on a hay bale in the barn
- Lemonade stand
- Napping under a tree

### Additional Features
- Harvest and collect tomatoes when fully grown
- Responsive UI that scales with panel size
- Integrates with VS Code theme colors
- Settings accessible via gear icon

## Installation

### From Source
```bash
git clone https://github.com/debiday/pomodoro-plants.git
cd pomodoro-plants
npm install
npm run compile
```

Press `F5` to launch the Extension Development Host. Find "Garden" in the Explorer sidebar.

### Building .vsix
```bash
npm install -g @vscode/vsce
vsce package
```

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `pomodoroPlants.pomodoroDuration` | 20 | Session length in minutes |
| `pomodoroPlants.shortBreakDuration` | 5 | Short break in minutes |
| `pomodoroPlants.longBreakDuration` | 15 | Long break in minutes |
| `pomodoroPlants.sessionsBeforeLongBreak` | 4 | Sessions before long break |

## Usage

1. Click Start to begin a Pomodoro session
2. Keep your editor focused to grow your plant
3. Watch it progress through 10 growth stages
4. Harvest when fully grown
5. Enjoy a break scene, then repeat

## Project Structure

```
pomodoro-plants/
├── src/
│   ├── extension.ts          # Extension entry point
│   └── plantViewProvider.ts  # Webview logic and pixel art
├── out/                      # Compiled JavaScript
├── package.json              # Extension manifest
└── tsconfig.json             # TypeScript config
```

## License

MIT
