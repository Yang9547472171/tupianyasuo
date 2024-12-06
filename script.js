document.addEventListener('DOMContentLoaded', function() {
    const uploadArea = document.getElementById('uploadArea');
    const imageInput = document.getElementById('imageInput');
    const filesPanel = document.getElementById('filesPanel');
    const filesList = document.getElementById('filesList');
    const downloadAllBtn = document.getElementById('downloadAllBtn');

    let processingFiles = new Map(); // 存储处理中的文件信息

    // 上传区域点击事件
    uploadArea.addEventListener('click', () => {
        imageInput.click();
    });

    // 拖放功能
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '#0071e3';
    });

    uploadArea.addEventListener('dragleave', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '#e5e5e5';
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '#e5e5e5';
        const files = Array.from(e.dataTransfer.files).slice(0, 10);
        handleFiles(files);
    });

    // 文件选择处理
    imageInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files).slice(0, 10);
        handleFiles(files);
    });

    // 下载所有按钮事件
    downloadAllBtn.addEventListener('click', async () => {
        const zip = new JSZip();
        let hasFiles = false;

        for (const [fileName, fileInfo] of processingFiles.entries()) {
            if (fileInfo.compressed && fileInfo.status === 'done') {
                zip.file(fileName, fileInfo.compressed);
                hasFiles = true;
            }
        }

        if (hasFiles) {
            downloadAllBtn.textContent = '打包中...';
            downloadAllBtn.disabled = true;
            
            try {
                const content = await zip.generateAsync({type: 'blob'});
                const url = URL.createObjectURL(content);
                const link = document.createElement('a');
                link.href = url;
                link.download = 'compressed_images.zip';
                link.click();
                URL.revokeObjectURL(url);
            } catch (error) {
                console.error('打包失败:', error);
                alert('打包失败，请重试');
            } finally {
                downloadAllBtn.textContent = '下载所有压缩图片';
                downloadAllBtn.disabled = false;
            }
        }
    });

    // 处理多个文件
    async function handleFiles(files) {
        if (!files.length) return;
        
        filesPanel.style.display = 'block';
        downloadAllBtn.disabled = true;

        // 创建文件列表项
        files.forEach(file => {
            if (file.type.startsWith('image/')) {
                const fileItem = createFileItem(file);
                filesList.appendChild(fileItem);
                processingFiles.set(file.name, { element: fileItem, status: 'processing' });
                processFile(file);
            }
        });
    }

    // 创建文件列表项
    function createFileItem(file) {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML = `
            <div class="file-info">
                <div class="file-name" title="${file.name}">${file.name}</div>
                <div class="file-sizes">
                    原始大小：${formatFileSize(file.size)}
                    <span class="compressed-size"></span>
                    <span class="file-status processing">（压缩中...）</span>
                </div>
            </div>
            <button class="download-single" disabled>下载</button>
        `;

        // 添加单个文件下载事件
        const downloadBtn = item.querySelector('.download-single');
        downloadBtn.addEventListener('click', () => {
            const fileInfo = processingFiles.get(file.name);
            if (fileInfo && fileInfo.compressed) {
                const url = URL.createObjectURL(fileInfo.compressed);
                const link = document.createElement('a');
                link.href = url;
                link.download = `compressed_${file.name}`;
                link.click();
                URL.revokeObjectURL(url);
            }
        });

        return item;
    }

    // 处理单个文件
    async function processFile(file) {
        const fileInfo = processingFiles.get(file.name);
        const element = fileInfo.element;
        const statusElement = element.querySelector('.file-status');
        const compressedSizeElement = element.querySelector('.compressed-size');
        const downloadBtn = element.querySelector('.download-single');

        try {
            const compressedFile = await smartCompress(file);
            const compressionRatio = 1 - (compressedFile.size / file.size);

            if (compressionRatio <= 0) {
                statusElement.textContent = '（已是最佳大小）';
                compressedSizeElement.textContent = '';
                downloadBtn.disabled = true;
            } else {
                statusElement.textContent = '（压缩完成）';
                compressedSizeElement.textContent = ` → ${formatFileSize(compressedFile.size)}`;
                downloadBtn.disabled = false;
            }

            statusElement.className = 'file-status done';
            processingFiles.set(file.name, {
                ...fileInfo,
                compressed: compressedFile,
                status: 'done'
            });

        } catch (error) {
            console.error('压缩失败:', error);
            statusElement.textContent = '（压缩失败）';
            statusElement.className = 'file-status error';
            downloadBtn.disabled = true;
            processingFiles.set(file.name, {
                ...fileInfo,
                status: 'error'
            });
        }

        checkAllFilesProcessed();
    }

    // 检查是否所有文件都处理完成
    function checkAllFilesProcessed() {
        const allDone = Array.from(processingFiles.values())
            .every(file => file.status === 'done' || file.status === 'error');
        
        if (allDone) {
            const hasCompressedFiles = Array.from(processingFiles.values())
                .some(file => file.compressed);
            downloadAllBtn.disabled = !hasCompressedFiles;
        }
    }

    // 智能压缩算法
    async function smartCompress(file) {
        const baseOptions = {
            useWebWorker: true,
            fileType: file.type,
            alwaysKeepResolution: true,
            preserveExif: false
        };

        try {
            // 根据文件大小直接决定压缩策略
            let quality, targetSizeMB;
            const fileSizeMB = file.size / (1024 * 1024);

            if (fileSizeMB <= 0.2) { // 200KB以下
                // 小文件只做无损压缩
                return await imageCompression(file, {
                    ...baseOptions,
                    maxSizeMB: fileSizeMB,
                    initialQuality: 1.0
                });
            }

            // 对于大文件，直接使用单次压缩
            const isPNG = file.type === 'image/png';
            const isScreenshot = await isScreenshotImage(file);

            if (fileSizeMB > 5) { // 5MB以上
                quality = isPNG || isScreenshot ? 0.85 : 0.8;
                targetSizeMB = 1.5;
            } else if (fileSizeMB > 2) { // 2MB-5MB
                quality = isPNG || isScreenshot ? 0.9 : 0.85;
                targetSizeMB = 1;
            } else { // 200KB-2MB
                quality = isPNG || isScreenshot ? 0.95 : 0.9;
                targetSizeMB = fileSizeMB * 0.65; // 压缩到原大小的65%
            }

            // 单次压缩，不进行二次处理
            return await imageCompression(file, {
                ...baseOptions,
                maxSizeMB: targetSizeMB,
                initialQuality: quality
            });

        } catch (error) {
            console.error('压缩过程出错:', error);
            return file;
        }
    }

    // 检测是否为截图的辅助函数
    async function isScreenshotImage(file) {
        return new Promise((resolve) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            
            img.onload = () => {
                URL.revokeObjectURL(url);
                // 检查是否为常见的截图尺寸比例
                const ratio = img.width / img.height;
                const isCommonScreenRatio = (
                    ratio === 16/9 || // 1920x1080 等
                    ratio === 16/10 || // 1920x1200 等
                    ratio === 4/3 || // 1024x768 等
                    Math.abs(ratio - 1.6) < 0.1 // 接近黄金比例的截图
                );
                
                // 检查图片尺寸是否符合常见显示器分辨率
                const isCommonResolution = (
                    img.width === 1920 ||
                    img.width === 2560 ||
                    img.width === 3840 ||
                    img.height === 1080 ||
                    img.height === 1440 ||
                    img.height === 2160
                );
                
                resolve(isCommonScreenRatio && isCommonResolution);
            };
            
            img.onerror = () => resolve(false);
            img.src = url;
        });
    }

    // 格式化文件大小
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}); 