cask "yggdrasil" do
  version "0.5.0"

  on_arm do
    sha256 "e9109730ee95921868f9857ecc450000ef7b98f28c7c0180f255f66b98a50c67"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.5.0/Yggdrasil-20261117-mac-arm64.dmg"
  end

  on_intel do
    sha256 "b797b0f8e375084aa543d564ed1c68a1170ab10f8fea637a4d7a88eb76b15a51"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.5.0/Yggdrasil-20261117-mac-intel.dmg"
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
