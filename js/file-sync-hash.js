/**
 * MD5 of a File/Blob, to compare against an S3 ETag.
 *
 * Valid because every My Files upload is a single PUT (the 10 GB quota sits
 * below S3's 5 GB single-PUT cap precisely so multipart is never used), and a
 * single-PUT object's ETag is the MD5 of its bytes.
 *
 * Hashed in chunks so a large file never has to sit in memory whole.
 */
(function (root) {
  'use strict';

  const CHUNK_BYTES = 4 * 1024 * 1024;

  function md5(blob) {
    return new Promise((resolve, reject) => {
      if (!root.SparkMD5) {
        reject(new Error('SparkMD5 not loaded'));
        return;
      }
      const spark = new root.SparkMD5.ArrayBuffer();
      const reader = new FileReader();
      let offset = 0;

      function readNext() {
        reader.readAsArrayBuffer(blob.slice(offset, offset + CHUNK_BYTES));
      }

      reader.onload = () => {
        spark.append(reader.result);
        offset += CHUNK_BYTES;
        if (offset < blob.size) readNext();
        else resolve(spark.end());
      };
      reader.onerror = () => reject(reader.error);

      if (blob.size === 0) resolve(spark.end());
      else readNext();
    });
  }

  root.FileSyncHash = { md5 };
}(typeof self !== 'undefined' ? self : this));
