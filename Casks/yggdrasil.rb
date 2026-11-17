cask "yggdrasil" do
  version "0.5.0"

  on_arm do
    sha256 "873ee4b572b50c55248f5e934f62f4889cc2b1ebd6d8eccf4fb808fc00d0f757"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.5.0/Yggdrasil-20261117-mac-arm64.dmg"
  end

  on_intel do
    sha256 "c11cbc3bbde6d71e71167454db2fce1dd847fc566e70933db982a15bb48fded9"
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
