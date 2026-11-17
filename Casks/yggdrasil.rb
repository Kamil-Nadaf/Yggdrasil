cask "yggdrasil" do
  version "0.5.2"

  on_arm do
    sha256 "604f7e6777ab964b2f373626fef21a6a498257504e06379b758eb815daeb0565"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.5.2/Yggdrasil-20261117-mac-arm64.dmg"
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
