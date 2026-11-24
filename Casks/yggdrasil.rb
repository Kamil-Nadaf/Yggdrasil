cask "yggdrasil" do
  version "0.5.10"

  on_arm do
    sha256 "251ad13940f742131e97e307fa8eec0bfb475760a6bfaa22826c24410dbda6d9"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.5.10/Yggdrasil-20261124-mac-arm64.dmg"
  end

  on_intel do
    sha256 "669a07ecd37e4aebd82727c2605712b608b74397e2567a8bea1dd985e33a5fbe"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.5.10/Yggdrasil-20261124-mac-intel.dmg"
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
