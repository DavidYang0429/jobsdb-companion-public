# PDF v1 字体资源

供本地 PDF 导出使用，离线打包。此目录版本一旦用于历史简历，不原地替换字体。

- Inter-Regular.ttf：从已安装的 @fontsource/inter 5.3.0 的 inter-latin-400-normal.woff 转换为 TTF。许可证见 ../../licenses/Inter-OFL.txt。
- NotoSansSC-Regular.ttf、NotoSansTC-Regular.ttf：来自 Google Fonts 的 NotoSansSC[wght].ttf 和 NotoSansTC[wght].ttf，使用 fontTools 4.67.0 固定 wght=400，得到静态 TrueType。许可证见 ../../licenses/NotoSansSC-OFL.txt 与 NotoSansTC-OFL.txt。

上游：

- https://github.com/google/fonts/tree/main/ofl/notosanssc
- https://github.com/google/fonts/tree/main/ofl/notosanstc

导出使用完整字体嵌入，避免当前 fontkit 字体裁剪在 CJK 中出现缺字。纯英文优先 Inter；混合或中文内容使用相应 Noto 字体。中文 PDF 会包含完整 CJK 字体，因此文件较大。
