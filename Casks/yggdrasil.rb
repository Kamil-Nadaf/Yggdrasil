cask "yggdrasil" do
  version "0.5.2"

  on_arm do
    sha256 "f13495c5a2ffff6f11855b8dd8aa56257e1d95da53e0c6f1f9f2b5d21905c688"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.5.2/Yggdrasil-20261117-mac-arm64.dmg"
  end

  on_intel do
    sha256 "04910c34229f639adbcc83f6cb1aacbca4b19179105582b1fd6a7339e1d646e0"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.5.2/Yggdrasil-20261117-mac-intel.dmg"
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
