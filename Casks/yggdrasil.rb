cask "yggdrasil" do
  version "0.5.3"

  on_arm do
    sha256 "504753812157bc7f6128f62f2bf158e3c4470a771520b3131be992c1476d0621"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.5.3/Yggdrasil-20261118-mac-arm64.dmg"
  end

  on_intel do
    sha256 "1809a62d9689d818d47988afb6c1592111becb73b479e51a3f8b5d96011dd35b"
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
