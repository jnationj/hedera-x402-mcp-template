// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title FileRegistry
 * @notice On-chain source of truth for an x402 "pay-per-use" file marketplace.
 *
 * Each registered file points at an object stored off-chain in a private,
 * S3-compatible bucket (MinIO in this template). The registry never holds the
 * file bytes or any funds; it only records who owns a file, how much it costs,
 * whether it is public, and where to find it.
 *
 * Access is enforced off-chain by the resource server:
 *  - Public files are served to anyone.
 *  - Private files are gated behind an x402 payment of `priceTinybar` HBAR to
 *    the owner's `payToAccountId`, settled per-download. There is no allow-list:
 *    a file is made effectively private by setting an arbitrarily high price.
 *  - Delisted files are treated as not found (no downloads, no marketplace row).
 *    The owner may register the same `objectKey` again after delisting.
 *
 * The bucket is private and all reads flow through the server's presigned URLs,
 * so storing `objectKey` on-chain does not leak the file contents.
 */
contract FileRegistry {
    /// @notice Asset id used by x402 to denote native HBAR. Prices are quoted in tinybars (1 HBAR = 1e8 tinybars).
    string public constant PAYMENT_ASSET = "0.0.0";

    /// @notice Upper bound on `getFiles` page size to keep view-call gas and return data predictable.
    uint256 public constant MAX_PAGE_SIZE = 50;

    /**
     * @notice A registered file and its access terms.
     * @param owner EVM address that registered the file and controls it.
     * @param payToAccountId Hedera account id (e.g. "0.0.1234") that receives x402 payments for this file.
     * @param priceTinybar Price per download in tinybars. Ignored when `isPublic` is true.
     * @param isPublic When true, anyone may download for free; when false, payment is required per download.
     * @param objectKey Key of the object in the private storage bucket.
     * @param contentHash SHA-256 of the file contents, for integrity verification.
     * @param name Human-readable file name.
     * @param mimeType MIME type of the file.
     * @param exists Whether this slot holds a registered file (guards against zeroed structs).
     */
    struct FileItem {
        address owner;
        string payToAccountId;
        uint256 priceTinybar;
        bool isPublic;
        string objectKey;
        bytes32 contentHash;
        string name;
        string mimeType;
        bool exists;
    }

    /// @notice Lookup of file metadata by file id.
    mapping(bytes32 fileId => FileItem file) private _files;

    /// @notice All registered file ids, in registration order, for enumeration.
    bytes32[] private _fileIds;

    /**
     * @notice Emitted when a new file is registered.
     * @dev `objectKey` and `payToAccountId` are unindexed so the full values are available to off-chain indexers.
     */
    event FileRegistered(
        bytes32 indexed fileId,
        address indexed owner,
        string objectKey,
        string payToAccountId,
        uint256 priceTinybar,
        bool isPublic,
        bytes32 contentHash,
        string name,
        string mimeType
    );

    /// @notice Emitted when a file's price is updated.
    event PriceChanged(bytes32 indexed fileId, uint256 oldPriceTinybar, uint256 newPriceTinybar);

    /// @notice Emitted when a file's visibility is updated.
    event VisibilityChanged(bytes32 indexed fileId, bool isPublic);

    /// @notice Emitted when a file's payout account is updated.
    event PayToChanged(bytes32 indexed fileId, string oldPayToAccountId, string newPayToAccountId);

    /// @notice Emitted when an owner delists a file from the marketplace.
    event FileDelisted(bytes32 indexed fileId, address indexed owner);

    /// @notice Thrown when registering a file id that already exists.
    error FileAlreadyRegistered(bytes32 fileId);

    /// @notice Thrown when referencing a file id that has not been registered.
    error FileNotFound(bytes32 fileId);

    /// @notice Thrown when a non-owner attempts an owner-only action.
    error NotFileOwner(bytes32 fileId, address caller);

    /// @notice Thrown when a required string argument is empty.
    error EmptyValue(string field);

    /// @notice Thrown when `contentHash` is zero (a SHA-256 digest is required).
    error InvalidContentHash();

    /// @dev Restricts a function to the owner of `fileId`.
    modifier onlyFileOwner(bytes32 fileId) {
        FileItem storage file = _files[fileId];
        if (!file.exists) revert FileNotFound(fileId);
        if (file.owner != msg.sender) revert NotFileOwner(fileId, msg.sender);
        _;
    }

    /**
     * @notice Register a new file and its access terms.
     * @dev The file id is deterministic per (owner, objectKey), preventing duplicate registration of the
     *      same object by the same owner while letting different owners use independent object keys.
     * @param objectKey Key of the object in the private storage bucket (must be non-empty).
     * @param payToAccountId Hedera account id that receives payments for this file (must be non-empty).
     * @param priceTinybar Price per download in tinybars (ignored while the file is public).
     * @param isPublic Whether the file is freely downloadable.
     * @param contentHash SHA-256 of the file contents (must be non-zero).
     * @param name Human-readable file name.
     * @param mimeType MIME type of the file (must be non-empty).
     * @return fileId The id assigned to the newly registered file.
     */
    function registerFile(
        string calldata objectKey,
        string calldata payToAccountId,
        uint256 priceTinybar,
        bool isPublic,
        bytes32 contentHash,
        string calldata name,
        string calldata mimeType
    ) external returns (bytes32 fileId) {
        if (bytes(objectKey).length == 0) revert EmptyValue("objectKey");
        if (bytes(payToAccountId).length == 0) revert EmptyValue("payToAccountId");
        if (contentHash == bytes32(0)) revert InvalidContentHash();
        if (bytes(mimeType).length == 0) revert EmptyValue("mimeType");

        fileId = computeFileId(msg.sender, objectKey);
        if (_files[fileId].exists) revert FileAlreadyRegistered(fileId);

        _files[fileId] = FileItem({
            owner: msg.sender,
            payToAccountId: payToAccountId,
            priceTinybar: priceTinybar,
            isPublic: isPublic,
            objectKey: objectKey,
            contentHash: contentHash,
            name: name,
            mimeType: mimeType,
            exists: true
        });
        _fileIds.push(fileId);

        emit FileRegistered(
            fileId,
            msg.sender,
            objectKey,
            payToAccountId,
            priceTinybar,
            isPublic,
            contentHash,
            name,
            mimeType
        );
    }

    /**
     * @notice Update the per-download price of a file.
     * @param fileId Id of the file to update.
     * @param newPriceTinybar New price in tinybars.
     */
    function setPrice(bytes32 fileId, uint256 newPriceTinybar) external onlyFileOwner(fileId) {
        FileItem storage file = _files[fileId];
        uint256 oldPriceTinybar = file.priceTinybar;
        file.priceTinybar = newPriceTinybar;
        emit PriceChanged(fileId, oldPriceTinybar, newPriceTinybar);
    }

    /**
     * @notice Update the visibility of a file.
     * @param fileId Id of the file to update.
     * @param isPublic New visibility flag.
     */
    function setVisibility(bytes32 fileId, bool isPublic) external onlyFileOwner(fileId) {
        _files[fileId].isPublic = isPublic;
        emit VisibilityChanged(fileId, isPublic);
    }

    /**
     * @notice Update the Hedera account that receives payments for a file.
     * @param fileId Id of the file to update.
     * @param newPayToAccountId New payout account id (must be non-empty).
     */
    function setPayToAccountId(bytes32 fileId, string calldata newPayToAccountId) external onlyFileOwner(fileId) {
        if (bytes(newPayToAccountId).length == 0) revert EmptyValue("payToAccountId");
        FileItem storage file = _files[fileId];
        string memory oldPayToAccountId = file.payToAccountId;
        file.payToAccountId = newPayToAccountId;
        emit PayToChanged(fileId, oldPayToAccountId, newPayToAccountId);
    }

    /**
     * @notice Remove a file from the marketplace and block lookups by `fileId`.
     * @dev Sets `exists` to false and removes `fileId` from the enumeration array so
     *      `getFiles` and `getFileCount` stay accurate. Off-chain objects in MinIO are not
     *      deleted; the owner must manage storage separately. The same `objectKey` may be
     *      registered again after delisting.
     * @param fileId Id of the file to delist.
     */
    function delistFile(bytes32 fileId) external onlyFileOwner(fileId) {
        _files[fileId].exists = false;
        _removeFromFileIds(fileId);
        emit FileDelisted(fileId, msg.sender);
    }

    /**
     * @notice Deterministic file id for an (owner, objectKey) pair.
     * @param owner Address registering the file.
     * @param objectKey Storage object key.
     * @return The file id.
     */
    function computeFileId(address owner, string calldata objectKey) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(owner, objectKey));
    }

    /**
     * @notice Fetch a registered file.
     * @param fileId Id of the file.
     * @return The file metadata.
     */
    function getFile(bytes32 fileId) external view returns (FileItem memory) {
        FileItem memory file = _files[fileId];
        if (!file.exists) revert FileNotFound(fileId);
        return file;
    }

    /// @notice Number of active (non-delist) files in the marketplace.
    function getFileCount() external view returns (uint256) {
        return _fileIds.length;
    }

    /**
     * @notice Paginated list of files for marketplace listing.
     * @dev Returns at most `limit` files starting at `offset`, capped at {@link MAX_PAGE_SIZE}. If `offset` is
     *      beyond the end, returns empty arrays.
     * @param offset Index to start from.
     * @param limit Maximum number of files to return (values above `MAX_PAGE_SIZE` are clamped).
     * @return ids The file ids in the returned page.
     * @return files The file metadata in the returned page.
     */
    function getFiles(
        uint256 offset,
        uint256 limit
    ) external view returns (bytes32[] memory ids, FileItem[] memory files) {
        if (limit > MAX_PAGE_SIZE) {
            limit = MAX_PAGE_SIZE;
        }

        uint256 total = _fileIds.length;
        if (offset >= total || limit == 0) {
            return (new bytes32[](0), new FileItem[](0));
        }
        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 size = end - offset;

        ids = new bytes32[](size);
        files = new FileItem[](size);
        for (uint256 i = 0; i < size; i++) {
            bytes32 id = _fileIds[offset + i];
            ids[i] = id;
            files[i] = _files[id];
        }
    }

    /// @dev Removes `fileId` from `_fileIds` using swap-and-pop (O(n) scan; fine for template scale).
    function _removeFromFileIds(bytes32 fileId) private {
        uint256 len = _fileIds.length;
        for (uint256 i = 0; i < len; i++) {
            if (_fileIds[i] == fileId) {
                _fileIds[i] = _fileIds[len - 1];
                _fileIds.pop();
                return;
            }
        }
    }
}
