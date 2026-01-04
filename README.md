### Vibe-coded

### Admin Config Table
```sql
CREATE TABLE admin_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```
Stores admin password hash securely (SHA-256).# 🎰 Poker Seating Generator

A web application for managing poker game seating arrangements, tracking tournament progress, and maintaining player statistics. Built for serious poker nights with friends!

![Poker Seating Generator](https://img.shields.io/badge/status-active-success.svg)
![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

## ✨ Features

### 🪑 Smart Seating
- **Unique arrangements**: Never get the same seating twice - all arrangements are tracked and verified
- **Visual poker table**: See players positioned around a realistic rectangular poker table
- **Optimized distribution**: Maximum 2 players per side (with smart handling for 7 players)
- **Randomized seating**: Fair and random seat assignments for every game

### ⏱️ Tournament Mode
- **45-minute blind timer**: Automatic level progression with visual and audio alerts
- **Player elimination tracking**: Mark players as eliminated during tournament play
- **Start/Pause/Reset controls**: Full timer management
- **Visual warnings**: Color-coded alerts (yellow at 5 min, red at 1 min remaining)

### 📊 Statistics & History
- **Player stats**: Track games played, wins, and win rates for each player
- **Game history**: Complete record of all games with dates, players, and winners
- **Winner tracking**: Record tournament winners (optional)
- **Leaderboard**: Automatic ranking by win rate

### 🔐 Admin Features
- **Simple authentication**: Password-protected admin access
- **Edit games**: Change winners for past games
- **Delete games**: Remove games and automatically recalculate stats
- **Stats management**: Full control over game history

### 📱 Mobile-First Design
- **Responsive layout**: Works perfectly on phones, tablets, and desktops
- **Touch-friendly**: Large buttons and optimized for mobile interaction
- **Progressive design**: Adapts to any screen size

## 🚀 Quick Start

### Prerequisites
- Docker and Docker Compose
- (Optional) Cloudflare Tunnel for remote access

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/baltam0s/poker-seating.git
cd poker-seating
```

2. **Set up your player list**
Edit `public/index.html` and find this line:
```javascript
let predefinedPlayers = [
  'Dime', 'Lazić', 'Peđa', 'Đovani', 'Bane', 'Miha', 'Šegi'
];
```
Replace with your players' names.

3. **~~Configure admin password~~** ~~(Optional)~~
   **No configuration needed!** On first access, you'll be prompted to create a secure admin password. The password is hashed and stored securely in the database.

4. **Build and run**
```bash
docker-compose up -d
```

5. **Access the app**
Open your browser and navigate to:
- Local: `http://localhost:3001`
- Or configure Cloudflare Tunnel for remote access

## 📁 Project Structure

```
poker-seating/
├── server.js           # Express backend with SQLite
├── package.json        # Node.js dependencies
├── Dockerfile          # Docker configuration
├── docker-compose.yml  # Docker Compose setup
└── public/
    └── index.html      # Single-page application (HTML/CSS/JS)
```

## 🎮 How to Use

### For Players

1. **Select players**: Check the boxes for who's playing tonight
2. **Add new players**: Use the input field to add players not in the list
3. **Generate seating**: Click "Generate Seating" to create a unique arrangement
4. **View the table**: See everyone's seat position on the poker table
5. **Start the timer**: Use the blind timer to manage tournament levels
6. **Eliminate players**: Click the × button on eliminated players
7. **Record winner**: After the game, click the winner's name
8. **Check stats**: View player statistics and game history

### For Admins

1. **First-time setup**: On first access, click 🔐 Admin button and create your admin password (min. 6 characters)
2. **Login**: After setup, click 🔐 Admin and enter your password
3. **Edit games**: Go to Game History tab, hover over a game, click "Edit"
4. **Delete games**: Click "Delete" to remove games (stats auto-recalculate)
5. **Change password**: (Feature available - access via settings)
6. **Logout**: Click the 🔓 Admin button and confirm

## ⚙️ Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Internal container port |
| `NODE_ENV` | `production` | Node environment |

**Note**: Admin password is securely stored in the database (SHA-256 hashed) after first-time setup. No environment variables needed!

### Docker Ports

The app runs on port 3000 inside the container. Map it to any available host port:

```yaml
ports:
  - "3001:3000"  # Host:Container
```

### Data Persistence

Game data is stored in a Docker volume:
```yaml
volumes:
  - poker-data:/app/data
```

To reset all data:
```bash
docker-compose down -v
docker-compose up -d
```

## 🛠️ Technology Stack

- **Backend**: Node.js + Express
- **Database**: SQLite3
- **Frontend**: Vanilla JavaScript (no frameworks)
- **Styling**: Custom CSS with responsive design
- **Deployment**: Docker + Docker Compose
- **Hosting**: Compatible with Portainer, Cloudflare Tunnel

## 📊 Database Schema

### Games Table
```sql
CREATE TABLE games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  players TEXT NOT NULL,           -- JSON array
  seating_hash TEXT UNIQUE NOT NULL,
  winner TEXT
);
```

### Player Stats Table
```sql
CREATE TABLE player_stats (
  player TEXT PRIMARY KEY,
  games_played INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0
);
```

## 🔒 Security Features

- **First-time setup**: Create admin password on first use
- **Password hashing**: SHA-256 hashed passwords stored in database
- **No default passwords**: Each installation requires unique password creation
- **Token-based auth**: Secure session tokens that expire after 24 hours
- **Password change**: Admins can change password at any time
- **Use HTTPS**: Deploy with Cloudflare Tunnel or reverse proxy for encryption
- **No sensitive data**: Only game records and player names stored

### Security Best Practices

1. **Choose a strong password**: Use at least 8-12 characters with mixed case, numbers, and symbols
2. **Don't share admin credentials**: Keep admin access limited to trusted individuals
3. **Use HTTPS in production**: Never transmit passwords over unencrypted HTTP
4. **Regular backups**: Backup the Docker volume containing your database
5. **Monitor access**: Check Docker logs for suspicious activity

## 🐛 Troubleshooting

### Database migration errors
The app automatically adds missing columns. If you see errors about missing `winner` column, just restart the container.

### Can't see game history
Check Docker logs:
```bash
docker-compose logs poker-seating
```

### Port conflicts
If port 3001 is in use, change it in `docker-compose.yml`:
```yaml
ports:
  - "8080:3000"  # Use port 8080 instead
```

### Reset everything
```bash
docker-compose down -v
docker-compose up -d
```

## 🚧 Roadmap

- [ ] Buy-in and prize pool tracking
- [ ] Multiple tournament types
- [ ] Export stats to CSV/PDF
- [ ] Dark mode
- [ ] Player avatars
- [ ] Rebuy tracking
- [ ] Break timer
- [ ] Sound effects customization
- [ ] Multi-language support

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🎉 Acknowledgments

- Built for poker nights with friends
- Inspired by the need for fair, randomized seating
- Designed for tournament-style home games

---

**Made with ♠️♥️♣️♦️ for poker enthusiasts**