cask "yggdrasil" do
  version "0.5.3"

  on_arm do
    sha256 "4c2e45596c04b87ca9af0854eeae522d6e4d5ad8ee1711b0b1bd8b5eeee93f99"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.5.3/Yggdrasil-20261118-mac-arm64.dmg"
  end

  on_intel do
    sha256 "4b506a6cd75598d38fee585b3d7b1d3dcdd027409498c6dea8fd4c4ed233e9e5"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.5.3/Yggdrasil-20261118-mac-intel.dmg"
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
