cask "yggdrasil" do
  version "0.5.5"

  on_arm do
    sha256 "819439f2cdf459e2f6b878025599190593d383eb4df1aaa52e909c147463efcc"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.5.5/Yggdrasil-20261119-mac-arm64.dmg"
  end

  on_intel do
    sha256 "a900387fa7821578147bc585531be63c8cd8d2cea2119f58d640fc23f3a3c318"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.5.5/Yggdrasil-20261119-mac-intel.dmg"
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
