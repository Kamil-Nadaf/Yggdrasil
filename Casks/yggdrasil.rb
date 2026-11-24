cask "yggdrasil" do
  version "0.5.9"

  on_arm do
    sha256 "fda5eedc0fedf55bf7a9ba356a4ed5552e11b29e78ff900d1d2f81e6ad055273"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.5.9/Yggdrasil-20261124-mac-arm64.dmg"
  end

  on_intel do
    sha256 "d78f87829843966a045a5cb8b9e824de918ed983dcb6c57d2a3c8f012b504460"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.5.9/Yggdrasil-20261124-mac-intel.dmg"
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
