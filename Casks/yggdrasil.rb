cask "yggdrasil" do
  version "0.5.11"

  on_arm do
    sha256 "90ed963c8ad5535e33c16dc7eba90e58c932e438c76d62c82fe84f95bf09d011"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.5.11/Yggdrasil-20261125-mac-arm64.dmg"
  end

  on_intel do
    sha256 "d760da1146161762d612032a3924d8bd3f2e5d82f87d964a8bd509db7676667b"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.5.11/Yggdrasil-20261125-mac-intel.dmg"
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
