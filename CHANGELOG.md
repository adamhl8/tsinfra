## [0.16.0](https://github.com/adamhl8/tsinfra/compare/v0.15.0..v0.16.0) - 2026-11-23

### 🚀 Features

- _(ensure)_ give the fix a differing object ([12e08aa](https://github.com/adamhl8/tsinfra/commit/12e08aa68410ec2524fb9ec4c1adc06c997c2f10) by @adamhl8)

### 🚜 Refactor

- _(report)_ show a record's keys from differing ([a5499b4](https://github.com/adamhl8/tsinfra/commit/a5499b43297023dc4646312aba9da89968185ac9) by @adamhl8)

## [0.15.0](https://github.com/adamhl8/tsinfra/compare/v0.14.0..v0.15.0) - 2026-11-23

### 🚀 Features

- _(report)_ show step messages under their steps ([9135bf9](https://github.com/adamhl8/tsinfra/commit/9135bf92755d5f17a6e3958dc36c18c72c49326d) by @adamhl8)

- add h.log ([d4d73a9](https://github.com/adamhl8/tsinfra/commit/d4d73a9b51ee734db67ad03a4c7665af09f0ef5d) by @adamhl8)

## [0.14.0](https://github.com/adamhl8/tsinfra/compare/v0.13.1..v0.14.0) - 2026-11-22

### 🚀 Features

- _(ensure)_ give each fix want and a record's difference at any depth ([cb863b4](https://github.com/adamhl8/tsinfra/commit/cb863b4ebb60eb55652a06d5218e823f9940e6df) by @adamhl8)

### 🚜 Refactor

- _(ensure)_ record each comparison's difference for the fix and the report ([d4a0572](https://github.com/adamhl8/tsinfra/commit/d4a05726738fbc442366c7a0460d4c936f34f9dc) by @adamhl8)

## [0.13.1](https://github.com/adamhl8/tsinfra/compare/v0.13.0..v0.13.1) - 2026-11-21

### 🐛 Bug Fixes

- _(ensure)_ accept a record want whose type is an interface ([96c0280](https://github.com/adamhl8/tsinfra/commit/96c0280eabd57b38ef8e4745d19d9d3414077ac1) by @adamhl8)

### ⚙️ Miscellaneous Tasks

- give each project its own temp HOME ([81fb8e1](https://github.com/adamhl8/tsinfra/commit/81fb8e1c1c7306ab7ba8b18b8cb71a1e70edb2c3) by @adamhl8)

## [0.13.0](https://github.com/adamhl8/tsinfra/compare/v0.12.1..v0.13.0) - 2026-11-21

### 🚀 Features

- _(transport)_ start commands with no terminal ([b65ba70](https://github.com/adamhl8/tsinfra/commit/b65ba7062e54d65feac69f8ea9d03c4d4e4949f7) by @adamhl8)

- _(report)_ show what the check found for an empty want ([72c7d21](https://github.com/adamhl8/tsinfra/commit/72c7d21cb52a159973eb848d10aaaa2b6951e7f1) by @adamhl8)

- _(ensure)_ allow lists and sets in a record want ([5c3f8dc](https://github.com/adamhl8/tsinfra/commit/5c3f8dc480578009a415639f5e7f0565d2c3d208) by @adamhl8)

- _(ensure)_ allow nested records and null in a record want ([409eab5](https://github.com/adamhl8/tsinfra/commit/409eab574e903e8d4f05179253af7bf9bd6aa8e1) by @adamhl8)

## [0.12.1](https://github.com/adamhl8/tsinfra/compare/v0.12.0..v0.12.1) - 2026-11-20

### ⚙️ Miscellaneous Tasks

- _(deps)_ update dependencies ([0f34204](https://github.com/adamhl8/tsinfra/commit/0f34204fcfc5c810c288fd80332648573c6ce8ee) by @adamhl8)

- update NO_CLI_MESSAGE ([7b347c9](https://github.com/adamhl8/tsinfra/commit/7b347c952b78c6603eee38575b26abd1fee43031) by @adamhl8)

## [0.12.0](https://github.com/adamhl8/tsinfra/compare/v0.11.0..v0.12.0) - 2026-11-20

### 🚀 Features

- _(cli)_ hand off from a global tsinfra to the project's copy ([4e0a59e](https://github.com/adamhl8/tsinfra/commit/4e0a59e9baae8406b7ea0152c01e758886b086cd) by @adamhl8)

### 🚜 Refactor

- _(cli)_ split parsing the command line from running the hosts ([86a3853](https://github.com/adamhl8/tsinfra/commit/86a3853271c9e4c380e17f58d62fedff3d4aaaa9) by @adamhl8)

### 📚 Documentation

- describe the global tsinfra launcher ([dacf468](https://github.com/adamhl8/tsinfra/commit/dacf468c89c179eb29d226119df364f08a88b3bb) by @adamhl8)

## [0.11.0](https://github.com/adamhl8/tsinfra/compare/v0.10.0..v0.11.0) - 2026-11-20

### 🚀 Features

- give tool calls env and secretEnv ([fd877ce](https://github.com/adamhl8/tsinfra/commit/fd877ce8246bf612f729501a9172fbbee3a8a10e) by @adamhl8)

- show tool options in the report ([2a27c7b](https://github.com/adamhl8/tsinfra/commit/2a27c7ba48ed05c1a10b3730df25f9d2370ea044) by @adamhl8)

- record tool calls on their commands ([115138c](https://github.com/adamhl8/tsinfra/commit/115138c1726c00fdb706f16befc14245446d9361) by @adamhl8)

### ✨ Improvements

- _(report)_ show the tool's name next to the command ([0dc044a](https://github.com/adamhl8/tsinfra/commit/0dc044ae46aba9ed3d167605006fa43d0bd8cf63) by @adamhl8)

- _(report)_ mark phases with a heading element ([52e72c0](https://github.com/adamhl8/tsinfra/commit/52e72c04ac8efa1be1a61f82a6a7056dc0ce1ea0) by @adamhl8)

### 📚 Documentation

- update docs ([a62e9cf](https://github.com/adamhl8/tsinfra/commit/a62e9cf72b6a0f33a57c2624dd4cf48e56a05c83) by @adamhl8)

## [0.10.0](https://github.com/adamhl8/tsinfra/compare/v0.9.0..v0.10.0) - 2026-11-18

### 🚀 Features

- give a record want its unmet keys/values ([d9592a3](https://github.com/adamhl8/tsinfra/commit/d9592a3b8d72a8eecaa4fa852e1ccb714a6f4ca5) by @adamhl8)

### 📚 Documentation

- update docs ([d945b23](https://github.com/adamhl8/tsinfra/commit/d945b238336d1e6cc3290458dc67b393f4e58360) by @adamhl8)

## [0.9.0](https://github.com/adamhl8/tsinfra/compare/v0.8.0..v0.9.0) - 2026-11-18

### 🚀 Features

- allow link steps to set target attributes ([5cdc05d](https://github.com/adamhl8/tsinfra/commit/5cdc05d011c96172ad2687460e63794732192634) by @adamhl8)

- hide always runs in plan unless verbose ([37428f2](https://github.com/adamhl8/tsinfra/commit/37428f265f36df02593835ad9c1c2a50fe2356aa) by @adamhl8)

### 🐛 Bug Fixes

- resolve a path step's path before claiming it ([9f1294b](https://github.com/adamhl8/tsinfra/commit/9f1294b86701df09bb0234876331a53f79c84755) by @adamhl8)

- narrow h.meta based on the host options ([6f6d0be](https://github.com/adamhl8/tsinfra/commit/6f6d0be9e6faa2da8c2be3af397918e2c3839efd) by @adamhl8)

## [0.8.0](https://github.com/adamhl8/tsinfra/compare/v0.7.0..v0.8.0) - 2026-11-18

### 🚀 Features

- show live progress ([f5c2a85](https://github.com/adamhl8/tsinfra/commit/f5c2a85657ac7acf7f9e3dfc29ebc08f6d75f178) by @adamhl8)

## [0.7.0](https://github.com/adamhl8/tsinfra/compare/v0.6.0..v0.7.0) - 2026-11-18

### 🚀 Features

- add h.meta property ([84ac76e](https://github.com/adamhl8/tsinfra/commit/84ac76ecac551c49bb65ca391855d333f810e770) by @adamhl8)

## [0.6.0](https://github.com/adamhl8/tsinfra/compare/v0.5.0..v0.6.0) - 2026-11-18

### 🚀 Features

- show a read step's input in the report ([f857410](https://github.com/adamhl8/tsinfra/commit/f8574101613944f8663a51d8816f3fd64f031af0) by @adamhl8)

- take input on the tools and the read steps ([0330053](https://github.com/adamhl8/tsinfra/commit/0330053b6539463152412282d0ba394caf7ff678) by @adamhl8)

- send input to a command's stdin through the shell ([205323c](https://github.com/adamhl8/tsinfra/commit/205323cb3fcdd492126846d7180cb0b3b1e85ff7) by @adamhl8)

### 🐛 Bug Fixes

- give the 10 MB content tests room on macOS sh ([0bfab30](https://github.com/adamhl8/tsinfra/commit/0bfab30f0cd009c7ff0ca0ecba2d553b6e47a73b) by @adamhl8)

### 🚜 Refactor

- share file's content reading ([e6d8391](https://github.com/adamhl8/tsinfra/commit/e6d8391038e6f330ac1b6812c7878d1b0c2d0e4f) by @adamhl8)

## [0.5.0](https://github.com/adamhl8/tsinfra/compare/v0.4.0..v0.5.0) - 2026-11-17

### 🚀 Features

- compare a list want in order ([dd05558](https://github.com/adamhl8/tsinfra/commit/dd05558fd989170bc7735e1ba5bb77cadf3adf8c) by @adamhl8)

- add set as a want kind ([4e18edc](https://github.com/adamhl8/tsinfra/commit/4e18edc25ed6c51020accaf267091d96cbeb089b) by @adamhl8)

### 🚜 Refactor

- clean up project layout ([a6b4609](https://github.com/adamhl8/tsinfra/commit/a6b46091defb22f3c51cbe2e73b274546b200a18) by @adamhl8)

### 📚 Documentation

- update AGENTS.md ([d7bf8d8](https://github.com/adamhl8/tsinfra/commit/d7bf8d86e94a27de5123c0e82098e227c448df0e) by @adamhl8)

- document set wants and ordered list wants ([d3d9e2a](https://github.com/adamhl8/tsinfra/commit/d3d9e2a4a219f136149f0b91f55ddf7eae3dbe57) by @adamhl8)

## [0.4.0](https://github.com/adamhl8/tsinfra/compare/v0.3.0..v0.4.0) - 2026-11-17

### 🚀 Features

- add dir step options ([b84db8c](https://github.com/adamhl8/tsinfra/commit/b84db8c0a7f03388d2c239ea25722d4c3544ece7) by @adamhl8)

- add dir step ([018d6f2](https://github.com/adamhl8/tsinfra/commit/018d6f2ce8a2f827837dcdfdf902e8d95d267295) by @adamhl8)

- allow an object want to take numbers and booleans ([d391daf](https://github.com/adamhl8/tsinfra/commit/d391dafaa23b768cddec0ad38ca2bce1fd3476a2) by @adamhl8)

### 🚜 Refactor

- share the stat command and owner columns between file and link ([96ca867](https://github.com/adamhl8/tsinfra/commit/96ca86723415ff7fd668e836247e4d64e1d362e0) by @adamhl8)

### ⚙️ Miscellaneous Tasks

- add dir tests ([7a6a632](https://github.com/adamhl8/tsinfra/commit/7a6a63200c2416c455404ddc29993fb88e43bbba) by @adamhl8)

### 📚 Documentation

- document h.dir ([236ee58](https://github.com/adamhl8/tsinfra/commit/236ee585d332c5b13b21e00ce0a206704b369fda) by @adamhl8)

## [0.3.0](https://github.com/adamhl8/tsinfra/compare/v0.2.0..v0.3.0) - 2026-11-16

### 🚀 Features

- report resume steps and count runs from open changes as drift ([be5cf12](https://github.com/adamhl8/tsinfra/commit/be5cf1222c981f4b39d4bed503a0d15f03bd9633) by @adamhl8)

- trigger runs from changes still open from an earlier apply ([32e11b2](https://github.com/adamhl8/tsinfra/commit/32e11b2ebd2cbb29a81cbcd647d9d0595051cdc0) by @adamhl8)

- open changes in apply and close them after a clean run ([9818605](https://github.com/adamhl8/tsinfra/commit/9818605c981e72c3e7aed4440a7395922914e009) by @adamhl8)

- add saved state manager ([8187a3e](https://github.com/adamhl8/tsinfra/commit/8187a3e7acdc1e02e87b430b9156f4ea30dd2bb1) by @adamhl8)

- reject duplicate step names ([bd36e03](https://github.com/adamhl8/tsinfra/commit/bd36e034bbefe91beb408d73007684d793fa5c5e) by @adamhl8)

### 🚜 Refactor

- simplify host definition and get name from the host config ([447619e](https://github.com/adamhl8/tsinfra/commit/447619ecb9e638f2e468cb1b2ec0a49f2b66e2c2) by @adamhl8)

- check $HOME in preparation and give tests their own home ([75e151d](https://github.com/adamhl8/tsinfra/commit/75e151d0c755608d9a9ada9c62bcadfc70b29699) by @adamhl8)

### ⚙️ Miscellaneous Tasks

- update tests and docs ([c7264ac](https://github.com/adamhl8/tsinfra/commit/c7264ac934242c38b2913679a34e669ff5ae90e2) by @adamhl8)

## [0.2.0](https://github.com/adamhl8/tsinfra/compare/v0.1.0..v0.2.0) - 2026-11-14

### 🚀 Features

- allow ensure to compare objects ([4842116](https://github.com/adamhl8/tsinfra/commit/4842116b2db6d6fb1b5f5bd0d3247318a7ffa0f1) by @adamhl8)

- allow want to take a string[] ([8aa5296](https://github.com/adamhl8/tsinfra/commit/8aa52960ad9b9b44e6458ae2a4816825a9da3cfc) by @adamhl8)

- pass fix the diff ([936da90](https://github.com/adamhl8/tsinfra/commit/936da90f2cd9f7e9e8fd7f73db67eadb81595bd9) by @adamhl8)

### 🚜 Refactor

- want before check ([af1eb80](https://github.com/adamhl8/tsinfra/commit/af1eb80c508508b51ea9dfbde3e1ec2e05a0639a) by @adamhl8)

- _(report)_ rename element functions ([75f1e34](https://github.com/adamhl8/tsinfra/commit/75f1e3414588bdeb1732971ab922dc9d800fd400) by @adamhl8)

- _(report)_ let the formatter hold message text ([b7542e4](https://github.com/adamhl8/tsinfra/commit/b7542e49b3bfe0bec91cdee72b924f31d2f9084c) by @adamhl8)

- _(report)_ separate element formatters ([42aa748](https://github.com/adamhl8/tsinfra/commit/42aa748c8fc37b83755f680aee4b83dc28ca84cd) by @adamhl8)

## [0.1.0](https://github.com/adamhl8/tsinfra/compare/v0.0.0..v0.1.0) - 2026-11-13

### 🚀 Features

- _(report)_ exclude -vvv note under -vvv ([877f7d2](https://github.com/adamhl8/tsinfra/commit/877f7d25c2cde2a487baf82e1b5720d32a9e9215) by @adamhl8)

- _(report)_ add command phase to -vvv ([7470196](https://github.com/adamhl8/tsinfra/commit/74701965461d939fb50a9c41e870dc69e2b0fdd3) by @adamhl8)

- _(report)_ add stdout and stderr to -vvv ([795704c](https://github.com/adamhl8/tsinfra/commit/795704cd4418094195e6d4fc7e59a25d73feefd6) by @adamhl8)

- _(report)_ add command output to -vvv ([b1d9d2a](https://github.com/adamhl8/tsinfra/commit/b1d9d2a05e4043c7ae844d23776e6a46f12df79a) by @adamhl8)

- _(report)_ show preparation errors ([5a6c2ab](https://github.com/adamhl8/tsinfra/commit/5a6c2abdc40a93b458dfcf16695a9a0237f987ab) by @adamhl8)

- _(report)_ display all step options ([4b027bd](https://github.com/adamhl8/tsinfra/commit/4b027bd04e7b583c5fba5d2316b4a53d4960657b) by @adamhl8)

- _(report)_ show commands under -vv ([b52a5a3](https://github.com/adamhl8/tsinfra/commit/b52a5a3fa486d5bba52cdac09a6e74cd1744ef57) by @adamhl8)

- _(report)_ show option values under -vv ([179ca98](https://github.com/adamhl8/tsinfra/commit/179ca98da5da5e7579a539ff156ed8bff1f4dcbc) by @adamhl8)

- _(report)_ add options note ([9ba76fe](https://github.com/adamhl8/tsinfra/commit/9ba76febc8097c992540d583e4d030691c7bff96) by @adamhl8)

- step shell options ([e63e91a](https://github.com/adamhl8/tsinfra/commit/e63e91a228421efddbc3361daab9dd021c9358be) by @adamhl8)

- add secret masking ([4b2b293](https://github.com/adamhl8/tsinfra/commit/4b2b29365780fdc861a2d17d379efea97465e01c) by @adamhl8)

- add step shell options ([0700ac4](https://github.com/adamhl8/tsinfra/commit/0700ac418a5ff5e641d8b34eaa3572adcbb3d75f) by @adamhl8)

- add step options to the report ([cb9a189](https://github.com/adamhl8/tsinfra/commit/cb9a189cd5a9f035825adbb3ab185847f5daa538) by @adamhl8)

- add preparation recording ([0a2086e](https://github.com/adamhl8/tsinfra/commit/0a2086e7fddb7c43adfc0df345ee6a96dd0c6ae0) by @adamhl8)

- resolve local ssh options; refactor ([914cf33](https://github.com/adamhl8/tsinfra/commit/914cf33e8101d4ba31be8e7f62fa2896b0220ee0) by @adamhl8)

- add ssh transport ([50b9833](https://github.com/adamhl8/tsinfra/commit/50b98335db5c3a5713aa2245abe8634b073b00fe) by @adamhl8)

- _(file)_ add overwrite option ([59c096e](https://github.com/adamhl8/tsinfra/commit/59c096e5032882acebe5999f4fdbb94915e7e5c4) by @adamhl8)

- add failure hints ([6afc9c1](https://github.com/adamhl8/tsinfra/commit/6afc9c136bed5667bfec6fcdd705400e48aea6e4) by @adamhl8)

- add password read ([d87aa9e](https://github.com/adamhl8/tsinfra/commit/d87aa9e86efe8e44f11b5e0bf85977a414e153c7) by @adamhl8)

- add sudo host option ([70aba9f](https://github.com/adamhl8/tsinfra/commit/70aba9f13bfc71e2f7ff7cde05cdfdfb324d0362) by @adamhl8)

- _(file)_ add validate option ([6eb5177](https://github.com/adamhl8/tsinfra/commit/6eb51771b151ac4ecfbcfe657a35d9e8676f5e68) by @adamhl8)

- _(report)_ add step warnings ([36b0f41](https://github.com/adamhl8/tsinfra/commit/36b0f418f17e6eeb652615819abbcbb202cdb6a2) by @adamhl8)

- add getHostDetails on converge ([ee11cc0](https://github.com/adamhl8/tsinfra/commit/ee11cc07d0037fc837b55c9da3279b4516402701) by @adamhl8)

- add link ([e46ea75](https://github.com/adamhl8/tsinfra/commit/e46ea751a75ffe5fee6b2de331e0fbdb2aa69239) by @adamhl8)

- check file owner ([0d0012c](https://github.com/adamhl8/tsinfra/commit/0d0012ced691841a9fee2075f5c19b4fc7b89dc6) by @adamhl8)

- reject large files ([ddb445e](https://github.com/adamhl8/tsinfra/commit/ddb445e026eddbc5be3a9546608b0c2600247a2e) by @adamhl8)

- add sudo ([61d1322](https://github.com/adamhl8/tsinfra/commit/61d13221b69e253badf72a40f1c0e2ca4cb57022) by @adamhl8)

- add file write ([4c6298c](https://github.com/adamhl8/tsinfra/commit/4c6298cd4da1d94607c44345452420d384ef263e) by @adamhl8)

- prepare hosts ([238c1ba](https://github.com/adamhl8/tsinfra/commit/238c1ba94b31073434dc2326abc6b5235e9d978a) by @adamhl8)

- add file ([b8453a4](https://github.com/adamhl8/tsinfra/commit/b8453a4c06e205e717fb266c752732fec410fb76) by @adamhl8)

- add diffs ([e8bf13e](https://github.com/adamhl8/tsinfra/commit/e8bf13e872806ca9efa3b4d602331213c1ccc8aa) by @adamhl8)

- add verbose ([bcc6843](https://github.com/adamhl8/tsinfra/commit/bcc6843553d358c2bc7b61bc09489982b4a53b16) by @adamhl8)

- add needs ([b22340d](https://github.com/adamhl8/tsinfra/commit/b22340d746cb52f613f8c5d7a4cffc7b0f174d67) by @adamhl8)

- improve run options ([d774f01](https://github.com/adamhl8/tsinfra/commit/d774f015edd60443db1d0086b44f49079bc6e714) by @adamhl8)

- add inspect ([5bca0fb](https://github.com/adamhl8/tsinfra/commit/5bca0fbe38db32d1ad2a3ef8f5a0d4b22a08c998) by @adamhl8)

- merge ensure and ensureValue ([47d2a7a](https://github.com/adamhl8/tsinfra/commit/47d2a7aace2b6aaf608a72fbcc7b7db407b9e115) by @adamhl8)

- add output ([4fa2e2c](https://github.com/adamhl8/tsinfra/commit/4fa2e2c56f095bd267e89e87123d1931e2eeb892) by @adamhl8)

- exit 2 for drift ([f2dfa1f](https://github.com/adamhl8/tsinfra/commit/f2dfa1f19e6e26badf51e102e63af447fcf9cc23) by @adamhl8)

- add step recording ([d063987](https://github.com/adamhl8/tsinfra/commit/d063987fdf1670699b2bec39f67e9b87b0f38eb8) by @adamhl8)

- enforce one step at a time ([0509ed1](https://github.com/adamhl8/tsinfra/commit/0509ed15ff528bb3310ca2fc7c69447ac27faaa4) by @adamhl8)

- add step function tools ([e72a0b8](https://github.com/adamhl8/tsinfra/commit/e72a0b8090cc2fa40ac93a751ec252e8bf949e07) by @adamhl8)

- add run method ([b1b58ee](https://github.com/adamhl8/tsinfra/commit/b1b58ee94b760c1f15c4b9377483fe85788691ce) by @adamhl8)

- add verify option ([2a0ffe4](https://github.com/adamhl8/tsinfra/commit/2a0ffe48d18c3544f3291382270f06df4adc7093) by @adamhl8)

- add function form of fix ([636c82c](https://github.com/adamhl8/tsinfra/commit/636c82c3912a5c489e0906890fb82277273d53d9) by @adamhl8)

- add step function ([edd393e](https://github.com/adamhl8/tsinfra/commit/edd393e0ced4108836b9487cc59877d872dfcccd) by @adamhl8)

- add read function ([be44e57](https://github.com/adamhl8/tsinfra/commit/be44e57a8138e03ca547e9e2f9d1733f6204c3c0) by @adamhl8)

- add host object ([f15451c](https://github.com/adamhl8/tsinfra/commit/f15451c42305e22d2af21e7ea66db4da9419fdec) by @adamhl8)

- add local transport ([ccbc867](https://github.com/adamhl8/tsinfra/commit/ccbc867355568d73411fd1729b202f88a947b310) by @adamhl8)

- add host execution ([656bac7](https://github.com/adamhl8/tsinfra/commit/656bac770aebf7295150c927ca85cc8ed4d20f75) by @adamhl8)

- add host loading ([b2c0a3b](https://github.com/adamhl8/tsinfra/commit/b2c0a3b4f05727469c4420bd26cb8213d268d18f) by @adamhl8)

### ✨ Improvements

- better separate host failure kinds ([03be99d](https://github.com/adamhl8/tsinfra/commit/03be99df944ebff55075e80b0ee0183b0fe417cb) by @adamhl8)

- figure out failure hints during step execution ([ba89ee5](https://github.com/adamhl8/tsinfra/commit/ba89ee514a7bd0840775153d9e5b979b04dea66e) by @adamhl8)

- improve sudo prompt styling ([50d19b5](https://github.com/adamhl8/tsinfra/commit/50d19b53c8bf20ea5ad03c8b0c4a14b08b72061c) by @adamhl8)

- clean up report output ([3b81dee](https://github.com/adamhl8/tsinfra/commit/3b81dee622e1bfd32a0c627a1247277b8c3a5536) by @adamhl8)

- error handling and reporting ([a35d27a](https://github.com/adamhl8/tsinfra/commit/a35d27a7a58f197d85874b1135b55d51fafb162b) by @adamhl8)

- validate user input ([5d286d3](https://github.com/adamhl8/tsinfra/commit/5d286d3332ea526e49bafecd2ff4ff117a17055b) by @adamhl8)

### 🚜 Refactor

- rename step record options ([8dd4078](https://github.com/adamhl8/tsinfra/commit/8dd4078afd0694490fc1d0f989fd650c093ab648) by @adamhl8)

- step options ([1bb5017](https://github.com/adamhl8/tsinfra/commit/1bb5017d8c8c0ef58784f396f7ca3255fb453fe1) by @adamhl8)

- improve verbosity handling ([9ebaec2](https://github.com/adamhl8/tsinfra/commit/9ebaec261df5db2afd805d98a8f24ef2dabf69c1) by @adamhl8)

- diff limits ([44ae114](https://github.com/adamhl8/tsinfra/commit/44ae114a5e073656cc4e1dbde7a90232b3ee8258) by @adamhl8)

- report structure ([8b32111](https://github.com/adamhl8/tsinfra/commit/8b32111e74174fc2d90af40d585a7f3910b0946e) by @adamhl8)

- clean up failure hints ([376097d](https://github.com/adamhl8/tsinfra/commit/376097dbf4d94181ac52536c4fa448e5635a6dcb) by @adamhl8)

- more recorder improvements ([b142a4d](https://github.com/adamhl8/tsinfra/commit/b142a4d9f5cf233ae7b4ca8c18ab9e5748847c25) by @adamhl8)

- recorder improvements ([833736f](https://github.com/adamhl8/tsinfra/commit/833736fb4c4768b5d512038cfa22d524bae14d98) by @adamhl8)

- add HostEntry type ([cd2991a](https://github.com/adamhl8/tsinfra/commit/cd2991aa13e3a33bc7827ffdfe5a9226d859bad8) by @adamhl8)

- host details ([6b876a4](https://github.com/adamhl8/tsinfra/commit/6b876a46a26b5779d2f6530e6b605a9ae38a31a2) by @adamhl8)

- clean up transport and sudo handling ([e4ab275](https://github.com/adamhl8/tsinfra/commit/e4ab2757c851e98a54cc524dbd6f12b98596a082) by @adamhl8)

- clean up link ([b047c17](https://github.com/adamhl8/tsinfra/commit/b047c171ec1abbebf150a5cc4d6f6583684ccb81) by @adamhl8)

- clean up tests ([77e026a](https://github.com/adamhl8/tsinfra/commit/77e026afd78fc8dc493839b16ab156b884a1e61a) by @adamhl8)

- clean up file step ([ecea8b6](https://github.com/adamhl8/tsinfra/commit/ecea8b6e4a9b61c3bf71049b36a4a9166f94691a) by @adamhl8)

- split file step ([27f503a](https://github.com/adamhl8/tsinfra/commit/27f503a995625cea9969eb0c30239e48c8747837) by @adamhl8)

- clean up errors ([f949330](https://github.com/adamhl8/tsinfra/commit/f9493309bb754c2d0383f55b9ebd20e8fe9583dd) by @adamhl8)

- clean up tests ([3c05766](https://github.com/adamhl8/tsinfra/commit/3c057660769520724b34009581e1deccf37566bf) by @adamhl8)

- clean up types ([fcf839e](https://github.com/adamhl8/tsinfra/commit/fcf839e13f659c2f0de005230a3569476db6b9d7) by @adamhl8)

- more cleanup ([b4de468](https://github.com/adamhl8/tsinfra/commit/b4de46824e2ab1c0adb2c3299c4c857bbbf09f21) by @adamhl8)

- cleanup ([dbe8b86](https://github.com/adamhl8/tsinfra/commit/dbe8b86dd638a2665e5c65dc6c74bb7da1e11d0e) by @adamhl8)

- handlers ([cd69c4e](https://github.com/adamhl8/tsinfra/commit/cd69c4e82a3aa9ab475db0ab7645f5a47658be7f) by @adamhl8)

- clean up names ([feaef72](https://github.com/adamhl8/tsinfra/commit/feaef72e2c91778b041649e78ca4ad7e9d841c4e) by @adamhl8)

- split file ([34c9651](https://github.com/adamhl8/tsinfra/commit/34c965178eaadf122bf84296521715a22058bd6c) by @adamhl8)

- clean up report code ([2a97450](https://github.com/adamhl8/tsinfra/commit/2a974500530414862c58c77d65c5d1b70bcb4abe) by @adamhl8)

- split output.ts ([3739b45](https://github.com/adamhl8/tsinfra/commit/3739b45d9555a2086a246e72ebb98893ee4ac81f) by @adamhl8)

- add StepStatus for report ([5e7bd04](https://github.com/adamhl8/tsinfra/commit/5e7bd046332c79d2c36e80b0d333afd24b808c72) by @adamhl8)

- improve how check failures are handled ([8262f33](https://github.com/adamhl8/tsinfra/commit/8262f3342ca3686582aa98f73afd9dfcb2b11515) by @adamhl8)

- clean up step ([4fd130d](https://github.com/adamhl8/tsinfra/commit/4fd130d1abda6511be014d6df359e7f10f9737f9) by @adamhl8)

- clean up session ([e2eccac](https://github.com/adamhl8/tsinfra/commit/e2eccac72cc4e1c451a4a08148c154c05fbd6c12) by @adamhl8)

- rename host types ([f230bd6](https://github.com/adamhl8/tsinfra/commit/f230bd6b4ba39e6ecff8990dfbe41c4d2d48c30c) by @adamhl8)

- reorganize ([e9ddb97](https://github.com/adamhl8/tsinfra/commit/e9ddb9767ee1e84d9b78928da9245fafd8bccc81) by @adamhl8)

### ⚙️ Miscellaneous Tasks

- clean up tests ([5829c9a](https://github.com/adamhl8/tsinfra/commit/5829c9a7f318088ec43acfaf724215ea3b2d3bb2) by @adamhl8)

- enable coverage ([1cc2c69](https://github.com/adamhl8/tsinfra/commit/1cc2c69112420ce64c48a52d49d475db4707c31d) by @adamhl8)

## [0.0.0] - 2026-10-28
