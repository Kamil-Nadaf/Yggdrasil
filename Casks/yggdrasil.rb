cask "yggdrasil" do
  version "0.5.12"

  on_arm do
    sha256 "b1974c2213d608b1f9eb549bd1fa493be6729201b4646e6bb720ee3ebc958d44"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.5.12/Yggdrasil-20261126-mac-arm64.dmg"
  end

  on_intel do
    sha256 "25ab86df96deb5df85d1a2a82edd8623f5e9312c9efa9d4a97b1526d7bd58359"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.5.12/Yggdrasil-20261126-mac-intel.dmg"
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
