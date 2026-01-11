# 🌱 Pomodoro Plants

A cozy VS Code/Cursor extension that gamifies your focus sessions with pixel art plants! Watch your plant grow as you work through Pomodoro sessions, collect tomatoes, and enjoy relaxing farmer-themed break scenes.

![Pomodoro Plants Preview](https://img.shields.io/badge/version-0.1.0-green) ![VS Code](https://img.shields.io/badge/VS%20Code-Extension-blue)

## ✨ Features

### 🌿 Plant Growth System
- **10 unique growth stages** - Watch your plant evolve from dirt to a fruit-bearing tomato plant
- **Pixel art graphics** - Charming retro-style visuals
- **Progress tracking** - Hover over the progress bar to preview upcoming stages

### ⏱️ Pomodoro Timer
- **Customizable duration** - Set your preferred Pomodoro length (default: 20 minutes)
- **Focus tracking** - Timer only progresses when your editor is focused
- **Visual feedback** - Pulsing start button, progress bar, and stage labels

### 🍅 Harvest & Collection
- **Collect fruits** - Harvest tomatoes when your plant is fully grown
- **Daily garden** - Track your productivity with collected fruits
- **Satisfying rewards** - Visual celebration when you complete a session

### ☕ Break Time Scenes
- **4 relaxing farmer scenes** - Randomly selected break activities:
  - 🎣 **Fishing** - Watch the farmer fish with animated water and bobber
  - 🌿 **Hay Bale Rest** - Cozy barn scene with sunlight through the window
  - 🍋 **Lemonade Stand** - Refreshing break at a lemonade stand
  - 🌳 **Tree Nap** - Peaceful nap under a shady tree
- **Easter egg** - Click the break preview to cycle through activities!

### 🎨 UI Features
- **Responsive design** - Scales beautifully on different screen sizes
- **Theme integration** - Blends with your VS Code theme
- **Smooth animations** - Floating particles, hover effects, and transitions

## 📦 Installation

### From Source
1. Clone this repository
2. Run `npm install`
3. Run `npm run compile`
4. Press `F5` to launch the Extension Development Host
5. Find "Garden" in the Explorer sidebar

### Building for Production
```bash
npm install -g @vscode/vsce
vsce package
```

## ⚙️ Settings

Access settings via the gear icon (⚙️) in the extension panel or through VS Code settings:

| Setting | Default | Description |
|---------|---------|-------------|
| `pomodoroPlants.pomodoroDuration` | 20 | Pomodoro session length in minutes |
| `pomodoroPlants.shortBreakDuration` | 5 | Short break length in minutes |
| `pomodoroPlants.longBreakDuration` | 15 | Long break length in minutes |
| `pomodoroPlants.sessionsBeforeLongBreak` | 4 | Sessions before a long break |
| `pomodoroPlants.autoStartOnFocus` | false | Auto-start timer on focus |
| `pomodoroPlants.showNotifications` | true | Show notifications |

## 🎮 How to Use

1. **Start** - Click the pulsing green Start button
2. **Focus** - Keep your editor focused to grow your plant
3. **Watch** - See your plant progress through 10 growth stages
4. **Harvest** - Collect your tomato when fully grown
5. **Break** - Enjoy a relaxing farmer break scene
6. **Repeat** - Grow more plants and build your garden!

## 🛠️ Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch for changes
npm run watch

# Launch extension
# Press F5 in VS Code
```

## 📁 Project Structure

```
pomodoro-plants/
├── src/
│   ├── extension.ts          # Extension entry point
│   └── plantViewProvider.ts  # Main webview logic & pixel art
├── out/                      # Compiled JavaScript
├── package.json              # Extension manifest
└── tsconfig.json             # TypeScript config
```

## 🎨 Credits

- Pixel art and design inspired by cozy farming games
- Built with love for the VS Code community

## 📄 License

MIT License - feel free to use and modify!

---

**Happy focusing! 🌱🍅**

