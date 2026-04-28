# Service iObeya (start/stop/restart)

## Fichiers ajoutés

- `scripts/iobeyactl.sh`: contrôle direct docker compose (`start|stop|restart|status|logs|down`)
- `scripts/install-iobeya-systemd.sh`: installe un service systemd `iobeya`
- `ops/sudoers-iobeya-codex`: règle sudoers pour autoriser les commandes sans mot de passe

## Installation (one-shot, en root)

```bash
cd "/home/bvarisellaz/Assistant Pro/ReactApp/QAobeya"
sudo ./scripts/install-iobeya-systemd.sh
sudo cp ops/sudoers-iobeya-codex /etc/sudoers.d/iobeya-codex
sudo chmod 440 /etc/sudoers.d/iobeya-codex
sudo visudo -cf /etc/sudoers.d/iobeya-codex
```

## Usage manuel

```bash
sudo systemctl start iobeya
sudo systemctl stop iobeya
sudo systemctl restart iobeya
sudo systemctl status iobeya
```

Ou via script:

```bash
./scripts/iobeyactl.sh start
./scripts/iobeyactl.sh stop
./scripts/iobeyactl.sh restart
./scripts/iobeyactl.sh status
./scripts/iobeyactl.sh logs
```

## Après setup

Je pourrai exécuter pour toi:

```bash
sudo systemctl restart iobeya
```

sans te redemander de mot de passe.
