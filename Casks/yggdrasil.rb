cask "yggdrasil" do
  version "0.4.38"

  on_arm do
    sha256 "7bf12a3a5a19d70b5ac337bcda44b7668877f3a2d0ca59fb647e824ee8075854"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.4.38/Yggdrasil-20261116-mac-arm64.dmg"
  end

  on_intel do
    sha256 "90bb91e942de15719a5467ea2ba6432dcdb36ecbab431eaa27fe95e90221153a"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.4.38/Yggdrasil-20261116-mac-intel.dmg"
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
