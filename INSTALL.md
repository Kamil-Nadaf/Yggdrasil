# Installing Yggdrasil

Yggdrasil is a self-hosted research app for reading arXiv papers using the
CERIC active-reading method. It runs entirely on your computer — no Docker,
no cloud account required.

---

## macOS

### Requirements
- macOS 12 (Monterey) or later
- Works on both Apple Silicon (M1/M2/M3/M4) and Intel Macs

### Steps

1. Download `Yggdrasil-YYYYMMDD-mac.dmg` from the [Releases page](https://github.com/Kamil-Nadaf/Yggdrasil/releases).
2. Open the `.dmg` file.
3. Drag **Yggdrasil** into the **Applications** folder.
4. Eject the disk image.
5. Open **Yggdrasil** from Applications or Spotlight.

### Gatekeeper warning (unsigned app)

Because Yggdrasil is not yet signed with an Apple Developer certificate,
macOS will show a warning on first launch.

**Fix:**
- Right-click (or Control-click) the app → **Open**
- Click **Open** in the dialog that appears

You only need to do this once. After that, it opens normally.

If you see "Apple cannot check it for malicious software":
1. Go to **System Settings → Privacy & Security**
2. Scroll down to the security section
3. Click **Open Anyway** next to the Yggdrasil entry

### First launch

- Yggdrasil will ask where to save your notes (default: `~/Documents/Yggdrasil`)
- It may download TinyTeX (~200 MB) for the LaTeX Editor — this only happens once and needs internet

---

## Windows

### Requirements
- Windows 10 or Windows 11

### Steps

1. Download `Yggdrasil-YYYYMMDD-windows.zip` from the [Releases page](https://github.com/Kamil-Nadaf/Yggdrasil/releases).
2. Right-click the `.zip` file → **Extract All**
3. Choose a permanent location (e.g. `C:\Users\YourName\Yggdrasil`)  
   ⚠️ Do not run from inside the zip — extract first.
4. Open the extracted folder.
5. Double-click **`Yggdrasil.bat`**

### SmartScreen warning

Windows may show "Windows protected your PC" on first launch.

**Fix:**
- Click **More info**
- Click **Run anyway**

### First launch

- Yggdrasil will ask where to save your notes
- LaTeX Editor requires a separate LaTeX installation on Windows.  
  Install [MiKTeX](https://miktex.org/download) and make sure `pdflatex` is on your PATH.  
  All other features (Dashboard, Notes, Tasks, Search, Graph, Daily Archive) work without it.

---

## Linux

### Requirements
- Ubuntu 20.04+ / Debian 11+ / Fedora 36+ / Arch (or any modern distro)
- GTK and WebKit system libraries (see below)

### Install system dependencies first

**Ubuntu / Debian:**
```bash
sudo apt install python3-gi python3-gi-cairo gir1.2-gtk-3.0 gir1.2-webkit2-4.1
```

**Fedora:**
```bash
sudo dnf install python3-gobject gtk3 webkit2gtk3
```

**Arch:**
```bash
sudo pacman -S python-gobject gtk3 webkit2gtk
```

### Steps

1. Download `Yggdrasil-YYYYMMDD-linux.tar.gz` from the [Releases page](https://github.com/Kamil-Nadaf/Yggdrasil/releases).
2. Extract it:
   ```bash
   tar -xzf Yggdrasil-YYYYMMDD-linux.tar.gz
   cd Yggdrasil-linux
   ```
3. Run the installer (adds Yggdrasil to your app menu):
   ```bash
   ./install.sh
   ```
   Then launch it from your app menu like any other program.

   Or run it directly without installing:
   ```bash
   ./Yggdrasil
   ```

### First launch

- Yggdrasil will ask where to save your notes (default: `~/Documents/Yggdrasil`)
- TinyTeX downloads automatically on first launch if not already present

---

## Uninstalling

**macOS:** Drag Yggdrasil from Applications to Trash. Your notes folder is untouched.

**Windows:** Delete the extracted folder. Your notes folder is untouched.

**Linux:** Run `~/.local/share/Yggdrasil/uninstall.sh`, or delete `~/.local/share/Yggdrasil` manually.

Your notes (vault) are stored separately and are never deleted by uninstalling.

---

## Settings

After first launch, open the **gear icon** (top-right) to configure:

- **Data path** — where your notes are saved
- **AI Providers** — connect LM Studio, Claude, DeepSeek, OpenAI, or others
- **Theme** — dark, paper, tactile, observatory, manuscript, or custom

Ollama is optional and used only for the **Ask** view (searching your own notes).

---

## Troubleshooting

**App opens a blank window**  
The backend server may have failed to start. Check that no other app is using port 47285.

**"python3: command not found" on Linux**  
Install Python 3.12+: `sudo apt install python3.12`

**Notes not showing up**  
Go to Settings → Data and make sure the path points to your vault folder.

**LaTeX Editor shows an error**  
LaTeX is optional. Make sure TinyTeX finished downloading on first launch (needs internet).

---

© 2026 Kamil Nadaf · MIT License · [GitHub](https://github.com/Kamil-Nadaf/Yggdrasil)
