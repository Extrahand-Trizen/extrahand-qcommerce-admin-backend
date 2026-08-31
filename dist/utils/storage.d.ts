export interface UploadResult {
    url: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
}
export declare function uploadFile(file: Express.Multer.File, subdir: string): Promise<UploadResult>;
