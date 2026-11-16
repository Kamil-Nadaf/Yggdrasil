cask "yggdrasil" do
  version "0.4.36"

  on_arm do
    sha256 "05ff5fa61223e0484e2fc7b6a699701ed24add8a5c3f54864499e22b37cb044f"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.4.36/Yggdrasil-20261116-mac-arm64.dmg"
  end

  on_intel do
    sha256 "f35728f86e0a1228f2112e22cf06c711769e1ddaf63edd83b2bcc617b2464def"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.4.36/Yggdrasil-20261116-mac-intel.dmg"
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
