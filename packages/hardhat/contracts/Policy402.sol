// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IFileRegistry {
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

    function getFile(bytes32 fileId) external view returns (FileItem memory);
}

contract Policy402 {
    string internal constant POLICY_LABEL = "Policy402:v1";
    IFileRegistry public immutable fileRegistry;

    constructor(address fileRegistryAddress) {
        if (fileRegistryAddress == address(0)) revert InvalidFileRegistry();
        fileRegistry = IFileRegistry(fileRegistryAddress);
    }

    enum PolicyStatus {
        Active,
        Revoked
    }

    struct PolicyIdInput {
        bytes label;
        bytes32 serviceId;
    }

    struct PolicyHashInput {
        bytes label;
        bytes32 policyId;
        bytes32 serviceId;
        address owner;
        uint256 version;
        uint256 validFrom;
        uint256 validUntil;
        string paymentAsset;
        string payTo;
        uint256 priceTinybar;
    }

    struct PolicyState {
        bytes32 policyId;
        bytes32 fileId;
        bytes32 serviceId;
        address owner;
        uint256 currentVersion;
    }

    struct PolicyVersionState {
        bytes32 policyId;
        bytes32 fileId;
        bytes32 serviceId;
        address owner;
        uint256 version;
        uint256 validFrom;
        uint256 validUntil;
        string paymentAsset;
        string payTo;
        uint256 priceTinybar;
        PolicyStatus status;
        uint256 createdAt;
        bytes32 policyHash;
    }

    struct PolicyCreatedEventInput {
        bytes32 policyId;
        bytes32 fileId;
        bytes32 serviceId;
        address owner;
        uint256 version;
        bytes32 policyHash;
        uint256 validFrom;
        uint256 validUntil;
        string paymentAsset;
        string payTo;
        uint256 priceTinybar;
    }

    struct PolicyVersionEventInput {
        bytes32 policyId;
        bytes32 fileId;
        bytes32 serviceId;
        address owner;
        uint256 version;
        bytes32 policyHash;
        uint256 validFrom;
        uint256 validUntil;
        string paymentAsset;
        string payTo;
        uint256 priceTinybar;
    }

    struct PolicyRevokedEventInput {
        bytes32 policyId;
        bytes32 fileId;
        bytes32 serviceId;
        address owner;
        uint256 version;
        bytes32 policyHash;
    }

    mapping(bytes32 policyId => PolicyState) private _policies;
    mapping(bytes32 fileId => bytes32 policyId) private _fileToPolicyId;
    mapping(bytes32 serviceId => bytes32 policyId) private _serviceToPolicyId;
    mapping(bytes32 policyId => mapping(uint256 version => PolicyVersionState)) private _versions;
    mapping(bytes32 policyId => uint256 count) private _versionCounts;
    mapping(bytes32 policyId => bool exists) private _policyExists;
    mapping(bytes32 policyId => mapping(uint256 version => bool exists)) private _versionExists;

    event PolicyCreated(
        bytes32 indexed policyId,
        bytes32 indexed fileId,
        bytes32 indexed serviceId,
        address owner,
        uint256 version,
        bytes32 policyHash,
        uint256 validFrom,
        uint256 validUntil,
        string paymentAsset,
        string payTo,
        uint256 priceTinybar
    );

    event PolicyVersionCreated(
        bytes32 indexed policyId,
        bytes32 indexed fileId,
        bytes32 indexed serviceId,
        address owner,
        uint256 version,
        bytes32 policyHash,
        uint256 validFrom,
        uint256 validUntil,
        string paymentAsset,
        string payTo,
        uint256 priceTinybar
    );

    event PolicyRevoked(
        bytes32 indexed policyId,
        bytes32 indexed fileId,
        bytes32 indexed serviceId,
        address owner,
        uint256 version,
        bytes32 policyHash
    );

    error PolicyNotFound();
    error PolicyVersionNotFound();
    error PolicyAlreadyExists();
    error InvalidFileRegistry();
    error InvalidFileId();
    error InvalidServiceId();
    error InvalidValidityWindow();
    error InvalidPaymentAsset();
    error InvalidPayTo();
    error InvalidPrice();
    error NotOwner();
    error PolicyAlreadyRevoked();

    modifier onlyPolicyOwner(bytes32 policyId) {
        if (!_policyExists[policyId]) revert PolicyNotFound();
        if (_policies[policyId].owner != msg.sender) revert NotOwner();
        _;
    }

    function computeServiceId(string calldata descriptor) public pure returns (bytes32) {
        return keccak256(bytes(descriptor));
    }

    function computeFileServiceId(bytes32 fileId) public pure returns (bytes32) {
        return keccak256(bytes(string(abi.encodePacked("api://files/", _bytes32ToHexString(fileId)))));
    }

    function computePolicyId(bytes32 serviceId) public pure returns (bytes32) {
        return keccak256(abi.encode(bytes(POLICY_LABEL), serviceId));
    }

    function computePolicyHash(
        bytes32 policyId,
        bytes32 serviceId,
        address owner,
        uint256 version,
        uint256 validFrom,
        uint256 validUntil,
        string calldata paymentAsset,
        string calldata payTo,
        uint256 priceTinybar
    ) public pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    bytes(POLICY_LABEL),
                    policyId,
                    serviceId,
                    owner,
                    version,
                    validFrom,
                    validUntil,
                    paymentAsset,
                    payTo,
                    priceTinybar
                )
            );
    }

    function createPolicy(
        bytes32 fileId,
        bytes32 serviceId,
        uint256 validFrom,
        uint256 validUntil,
        string calldata paymentAsset,
        string calldata payTo,
        uint256 priceTinybar
    ) external returns (bytes32 policyId) {
        if (fileId == bytes32(0)) revert InvalidFileId();
        if (serviceId == bytes32(0)) revert InvalidServiceId();
        if (fileRegistry.getFile(fileId).owner != msg.sender) revert NotOwner();
        if (serviceId != computeFileServiceId(fileId)) revert InvalidServiceId();
        if (validUntil <= validFrom) revert InvalidValidityWindow();
        if (bytes(paymentAsset).length == 0) revert InvalidPaymentAsset();
        if (bytes(payTo).length == 0) revert InvalidPayTo();
        if (priceTinybar == 0) revert InvalidPrice();

        policyId = _computePolicyId(serviceId);
        if (_policyExists[policyId]) revert PolicyAlreadyExists();
        if (_serviceToPolicyId[serviceId] != bytes32(0)) revert PolicyAlreadyExists();
        if (_fileToPolicyId[fileId] != bytes32(0)) revert PolicyAlreadyExists();

        uint256 version = 1;
        bytes32 policyHash = _computePolicyHash(
            policyId,
            serviceId,
            msg.sender,
            version,
            validFrom,
            validUntil,
            paymentAsset,
            payTo,
            priceTinybar
        );

        _policies[policyId] = PolicyState({
            policyId: policyId,
            fileId: fileId,
            serviceId: serviceId,
            owner: msg.sender,
            currentVersion: version
        });
        _fileToPolicyId[fileId] = policyId;
        _setPolicyExists(policyId, true);
        _setServicePolicy(serviceId, policyId);

        PolicyVersionState memory versionState;
        versionState.policyId = policyId;
        versionState.fileId = fileId;
        versionState.serviceId = serviceId;
        versionState.owner = msg.sender;
        versionState.version = version;
        versionState.validFrom = validFrom;
        versionState.validUntil = validUntil;
        versionState.paymentAsset = paymentAsset;
        versionState.payTo = payTo;
        versionState.priceTinybar = priceTinybar;
        versionState.status = PolicyStatus.Active;
        versionState.createdAt = block.timestamp;
        versionState.policyHash = policyHash;
        _storeVersionRecord(policyId, version, versionState);

        _setVersionExists(policyId, version, true);
        _setVersionCount(policyId, version);

        PolicyCreatedEventInput memory policyCreatedEvent;
        policyCreatedEvent.policyId = policyId;
        policyCreatedEvent.fileId = fileId;
        policyCreatedEvent.serviceId = serviceId;
        policyCreatedEvent.owner = msg.sender;
        policyCreatedEvent.version = version;
        policyCreatedEvent.policyHash = policyHash;
        policyCreatedEvent.validFrom = validFrom;
        policyCreatedEvent.validUntil = validUntil;
        policyCreatedEvent.paymentAsset = paymentAsset;
        policyCreatedEvent.payTo = payTo;
        policyCreatedEvent.priceTinybar = priceTinybar;
        _emitPolicyCreated(policyCreatedEvent);
    }

    function createVersion(
        bytes32 policyId,
        uint256 validFrom,
        uint256 validUntil,
        string calldata paymentAsset,
        string calldata payTo,
        uint256 priceTinybar
    ) external onlyPolicyOwner(policyId) {
        if (!_policyExists[policyId]) revert PolicyNotFound();
        if (validUntil <= validFrom) revert InvalidValidityWindow();
        if (bytes(paymentAsset).length == 0) revert InvalidPaymentAsset();
        if (bytes(payTo).length == 0) revert InvalidPayTo();
        if (priceTinybar == 0) revert InvalidPrice();

        uint256 nextVersion = _policies[policyId].currentVersion + 1;
        bytes32 serviceId = _policies[policyId].serviceId;
        bytes32 policyHash = _computePolicyHash(
            policyId,
            serviceId,
            msg.sender,
            nextVersion,
            validFrom,
            validUntil,
            paymentAsset,
            payTo,
            priceTinybar
        );

        PolicyVersionState memory nextVersionState;
        nextVersionState.policyId = policyId;
        nextVersionState.fileId = _policies[policyId].fileId;
        nextVersionState.serviceId = serviceId;
        nextVersionState.owner = msg.sender;
        nextVersionState.version = nextVersion;
        nextVersionState.validFrom = validFrom;
        nextVersionState.validUntil = validUntil;
        nextVersionState.paymentAsset = paymentAsset;
        nextVersionState.payTo = payTo;
        nextVersionState.priceTinybar = priceTinybar;
        nextVersionState.status = PolicyStatus.Active;
        nextVersionState.createdAt = block.timestamp;
        nextVersionState.policyHash = policyHash;
        _storeVersionRecord(policyId, nextVersion, nextVersionState);

        _setVersionExists(policyId, nextVersion, true);
        _setVersionCount(policyId, nextVersion);
        _setCurrentVersion(policyId, nextVersion);

        PolicyVersionEventInput memory policyVersionEvent;
        policyVersionEvent.policyId = policyId;
        policyVersionEvent.fileId = _policies[policyId].fileId;
        policyVersionEvent.serviceId = serviceId;
        policyVersionEvent.owner = msg.sender;
        policyVersionEvent.version = nextVersion;
        policyVersionEvent.policyHash = policyHash;
        policyVersionEvent.validFrom = validFrom;
        policyVersionEvent.validUntil = validUntil;
        policyVersionEvent.paymentAsset = paymentAsset;
        policyVersionEvent.payTo = payTo;
        policyVersionEvent.priceTinybar = priceTinybar;
        _emitPolicyVersionCreated(policyVersionEvent);
    }

    function revokePolicy(bytes32 policyId, uint256 version) external onlyPolicyOwner(policyId) {
        if (!_versionExists[policyId][version]) revert PolicyVersionNotFound();
        if (_versions[policyId][version].status == PolicyStatus.Revoked) revert PolicyAlreadyRevoked();

        _versions[policyId][version].status = PolicyStatus.Revoked;

        PolicyRevokedEventInput memory revokedEvent;
        revokedEvent.policyId = policyId;
        revokedEvent.fileId = _versions[policyId][version].fileId;
        revokedEvent.serviceId = _versions[policyId][version].serviceId;
        revokedEvent.owner = _versions[policyId][version].owner;
        revokedEvent.version = version;
        revokedEvent.policyHash = _versions[policyId][version].policyHash;
        _emitPolicyRevoked(revokedEvent);
    }

    function getPolicy(bytes32 policyId) external view returns (PolicyState memory) {
        if (!_policyExists[policyId]) revert PolicyNotFound();
        return _policies[policyId];
    }

    function getPolicyVersion(bytes32 policyId, uint256 version) external view returns (PolicyVersionState memory) {
        if (!_versionExists[policyId][version]) revert PolicyVersionNotFound();
        return _versions[policyId][version];
    }

    function getCurrentPolicy(bytes32 serviceId) external view returns (PolicyState memory) {
        bytes32 policyId = _serviceToPolicyId[serviceId];
        if (!_policyExists[policyId]) revert PolicyNotFound();

        uint256 currentVersion = _policies[policyId].currentVersion;
        if (!_versionExists[policyId][currentVersion]) revert PolicyNotFound();
        if (_versions[policyId][currentVersion].status == PolicyStatus.Revoked) revert PolicyNotFound();

        return _policies[policyId];
    }

    function getPolicyVersionCount(bytes32 policyId) external view returns (uint256) {
        if (!_policyExists[policyId]) revert PolicyNotFound();
        return _versionCounts[policyId];
    }

    function getPolicyHash(bytes32 policyId, uint256 version) external view returns (bytes32) {
        if (!_versionExists[policyId][version]) revert PolicyVersionNotFound();
        return _versions[policyId][version].policyHash;
    }

    function isPolicyValid(bytes32 policyId, uint256 version) external view returns (bool) {
        if (!_versionExists[policyId][version]) revert PolicyVersionNotFound();
        return
            block.timestamp >= _versions[policyId][version].validFrom &&
            block.timestamp < _versions[policyId][version].validUntil &&
            _versions[policyId][version].status != PolicyStatus.Revoked;
    }

    function isPolicyValidAt(bytes32 policyId, uint256 version, uint256 timestamp) external view returns (bool) {
        if (!_versionExists[policyId][version]) revert PolicyVersionNotFound();
        return
            timestamp >= _versions[policyId][version].validFrom &&
            timestamp < _versions[policyId][version].validUntil &&
            _versions[policyId][version].status != PolicyStatus.Revoked;
    }

    function _computePolicyId(bytes32 serviceId) internal pure returns (bytes32) {
        return keccak256(abi.encode(bytes(POLICY_LABEL), serviceId));
    }

    function _computePolicyHash(
        bytes32 policyId,
        bytes32 serviceId,
        address owner,
        uint256 version,
        uint256 validFrom,
        uint256 validUntil,
        string memory paymentAsset,
        string memory payTo,
        uint256 priceTinybar
    ) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    bytes(POLICY_LABEL),
                    policyId,
                    serviceId,
                    owner,
                    version,
                    validFrom,
                    validUntil,
                    paymentAsset,
                    payTo,
                    priceTinybar
                )
            );
    }

    function _bytes32ToHexString(bytes32 value) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory output = new bytes(66);
        output[0] = "0";
        output[1] = "x";

        for (uint256 i = 0; i < 32; ++i) {
            uint8 byteValue = uint8(value[i]);
            output[2 + (i * 2)] = alphabet[byteValue >> 4];
            output[3 + (i * 2)] = alphabet[byteValue & 0x0f];
        }

        return string(output);
    }

    function _setPolicyExists(bytes32 policyId, bool exists) internal {
        _policyExists[policyId] = exists;
    }

    function _setServicePolicy(bytes32 serviceId, bytes32 policyId) internal {
        _serviceToPolicyId[serviceId] = policyId;
    }

    function _setVersionExists(bytes32 policyId, uint256 version, bool exists) internal {
        _versionExists[policyId][version] = exists;
    }

    function _setVersionCount(bytes32 policyId, uint256 count) internal {
        _versionCounts[policyId] = count;
    }

    function _setCurrentVersion(bytes32 policyId, uint256 version) internal {
        _policies[policyId].currentVersion = version;
    }

    function _storeVersionRecord(bytes32 policyId, uint256 version, PolicyVersionState memory record) internal {
        _versions[policyId][version] = record;
    }

    function _emitPolicyCreated(PolicyCreatedEventInput memory eventInput) internal {
        emit PolicyCreated(
            eventInput.policyId,
            eventInput.fileId,
            eventInput.serviceId,
            eventInput.owner,
            eventInput.version,
            eventInput.policyHash,
            eventInput.validFrom,
            eventInput.validUntil,
            eventInput.paymentAsset,
            eventInput.payTo,
            eventInput.priceTinybar
        );
    }

    function _emitPolicyVersionCreated(PolicyVersionEventInput memory eventInput) internal {
        emit PolicyVersionCreated(
            eventInput.policyId,
            eventInput.fileId,
            eventInput.serviceId,
            eventInput.owner,
            eventInput.version,
            eventInput.policyHash,
            eventInput.validFrom,
            eventInput.validUntil,
            eventInput.paymentAsset,
            eventInput.payTo,
            eventInput.priceTinybar
        );
    }

    function _emitPolicyRevoked(PolicyRevokedEventInput memory eventInput) internal {
        emit PolicyRevoked(
            eventInput.policyId,
            eventInput.fileId,
            eventInput.serviceId,
            eventInput.owner,
            eventInput.version,
            eventInput.policyHash
        );
    }
}
