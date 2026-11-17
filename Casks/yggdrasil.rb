cask "yggdrasil" do
  version "0.5.1"

  on_arm do
    sha256 "eea1473b62e8a60cb55847fc078a2925758a47e6d85a2ae1ba6fde677898fd78"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.5.1/Yggdrasil-20261117-mac-arm64.dmg"
  end

  on_intel do
    sha256 "ccee43cfdfccefd96596a576085956ce6160c8a578853891e3074940c63aee95"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.5.1/Yggdrasil-20261117-mac-intel.dmg"
  end

  name "Yggdrasil"
  desc "Self-hosted research app: read arXiv papers, notes, LaTeX, slides"
  homepage "https://github.com/Kamil-Nadaf/Yggdrasil"

  livecheck do
    url :url
    strategy :github_latest
  end

  # The app is not code-signed; drop the quarantine flag so it opens without the Gatekeeper dialog.
  app "Yggdrasil.app"
  postflight do
    system_command "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "#{appdir}/Yggdrasil.app"]
  end
end
